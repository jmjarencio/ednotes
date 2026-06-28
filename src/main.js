import { initializeApp } from "firebase/app";
import { 
    getAuth, 
    onAuthStateChanged, 
    signInWithCustomToken, 
    signInWithCredential, 
    GoogleAuthProvider 
} from "firebase/auth";
import { 
    getFirestore, doc, onSnapshot, setDoc, getDoc, increment, 
    collection, getDocs, query, orderBy, limit 
} from "firebase/firestore";
import { marked } from "marked";
import lottie from "lottie-web";
import QRCode from "qrcode";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDsK7mAo-lEV1gWmRNYF4eJ8EJDi2I2FrU",
    authDomain: "tech2forms.firebaseapp.com",
    projectId: "tech2forms",
    storageBucket: "tech2forms.firebasestorage.app",
    messagingSenderId: "704986097600",
    appId: "1:704986097600:web:616dff613824dac29bca25"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Keep firebase references globally accessible for internal routing components
window.db = db;
window.doc = doc;
window.setDoc = setDoc;
window.onSnapshot = onSnapshot;
window.increment = increment;
window.collection = collection;
window.getDocs = getDocs;
window.query = query;
window.orderBy = orderBy;
window.limit = limit;

// --- Clean URL Utility ---
function removeAuthQueryParams() {
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
}

// --- SSO Parameter Parser ---
// Safely parses and logs the user in if the parent dashboard redirected with credentials
async function checkSSOToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const customToken = urlParams.get('token') || urlParams.get('customToken') || urlParams.get('custom_token');
    const idToken = urlParams.get('idToken') || urlParams.get('id_token') || urlParams.get('credential');

    if (customToken) {
        try {
            await signInWithCustomToken(auth, customToken);
            removeAuthQueryParams();
        } catch (err) {
            console.error("SSO Custom Token authentication failed:", err);
        }
    } else if (idToken) {
        try {
            const credential = GoogleAuthProvider.credential(idToken);
            await signInWithCredential(auth, credential);
            removeAuthQueryParams();
        } catch (err) {
            console.error("SSO ID Token authentication failed:", err);
        }
    }
}

// --- Initialize App and Authenticate Watcher ---
async function initApp() {
    // 1. Process potential cross-subdomain tokens from portal redirect first
    await checkSSOToken();

    // 2. Bind the user listener
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.body.classList.add('authenticated');
            window.currentUser = user;

            if (user.email === 'jmjarencio@gmail.com' || user.email === 'johnmark.jarencio@deped.gov.ph') {
                document.getElementById('admin-btn').style.display = 'inline-flex';
            }
            
            const userRef = doc(db, "users_ednotes", user.uid);

            // DepEd check
            if (user.email && user.email.toLowerCase().endsWith('@deped.gov.ph')) {
                try {
                    const userSnap = await getDoc(userRef);
                    if (!userSnap.exists() || !userSnap.data().deped_free_credit_claimed) {
                        await setDoc(userRef, {
                            uid: user.uid,
                            email: user.email,
                            displayName: user.displayName,
                            deped_free_credit_claimed: true,
                            ednotes_credits: increment(1)
                        }, { merge: true });
                        
                        const dModal = document.getElementById('depedModal');
                        dModal.style.display = 'flex';
                        setTimeout(() => dModal.classList.add('active'), 10);
                    }
                } catch (err) {
                    console.error("DepEd verification system error:", err);
                }
            }
            
            onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const credits = Number(data.ednotes_credits) || 0;
                    document.getElementById('user-credits').innerText = credits;
                    window.currentEdNotesCredits = credits;
                } else {
                    setDoc(userRef, {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        lastLogin: new Date().toISOString()
                    }, { merge: true });
                    
                    document.getElementById('user-credits').innerText = 0;
                    window.currentEdNotesCredits = 0;
                }
            });
        } else {
            // --- LOOP PREVENTION GUARD ---
            const lastRedirect = sessionStorage.getItem('last_redirect_time');
            const now = Date.now();
            
            // If redirected within the last 6 seconds, we are in a loop. Halt to save resource load.
            if (lastRedirect && (now - Number(lastRedirect)) < 6000) {
                console.warn("Redirect loop detected. Stopping automatic redirect.");
                document.body.classList.add('authenticated');
                
                const notice = document.createElement('div');
                notice.style.cssText = "position:fixed; bottom:20px; right:20px; background:#ef4444; color:white; padding:16px 24px; border-radius:12px; z-index:100000; box-shadow:0 10px 15px rgba(0,0,0,0.1); font-weight:600; font-size:14px;";
                notice.innerHTML = "Authentication sync issue. Please try logging in again via the main <a href='https://tech2forms.com' style='color:white; text-decoration:underline;'>Edvantage Dashboard</a>.";
                document.body.appendChild(notice);
            } else {
                sessionStorage.setItem('last_redirect_time', now.toString());
                const returnUrl = encodeURIComponent(window.location.href);
                window.location.replace("https://tech2forms.com?redirect=" + returnUrl); 
            }
        }
    });
}

// Start application process
initApp();

// --- Modal Functions ---
export function openCreditModal() {
    const modal = document.getElementById('creditModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}

export function closeCreditModal() {
    const modal = document.getElementById('creditModal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        resetModalView();
    }, 300);
}

export function resetModalView() {
    document.getElementById('pricing-view').style.display = 'block';
    document.getElementById('qr-view').style.display = 'none';
    document.getElementById('modal-title').innerText = "💎 Get More Credits";
    document.getElementById('modal-subtitle').innerText = "Select a package to continue generating your lecture notes.";
    
    if (window.paymentListenerUnsubscribe) {
        window.paymentListenerUnsubscribe();
        window.paymentListenerUnsubscribe = null;
    }
}

// --- Payment Handling ---
export async function purchasePlan(planId) {
    if (!window.currentUser) {
        alert("Security Alert: Access restricted. Please log in first.");
        return;
    }

    const pricing = {
        'basic': 65,     
        'standard': 115, 
        'premium': 204,  
        'special': 304   
    };
    
    const amount = pricing[planId];
    const userId = window.currentUser.uid;
    const external_id = "EDNOTES_TX_" + userId + "_" + Date.now();

    document.getElementById('pricing-view').style.display = 'none';
    document.getElementById('qr-view').style.display = 'block';
    document.getElementById('modal-title').innerText = "Scan to Pay";
    document.getElementById('modal-subtitle').innerText = "Your secure QR Code is being generated...";
    
    document.getElementById('qr-amount-display').innerText = `₱${amount.toFixed(2)}`;
    document.getElementById('qr-instructions').style.display = 'none';
    document.getElementById('qr-code-box').innerHTML = '<div class="loader"></div><p style="margin-top:16px; font-size:13px; color:#666;">Connecting to Xendit Gateway...</p>';

    try {
        const response = await fetch("https://us-central1-tech2forms.cloudfunctions.net/createEdNotesXenditQRCode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ external_id, amount, userId })
        });

        const data = await response.json();
        
        if (!response.ok || data.error) {
            throw new Error(data.error || "Failed to generate QR Code");
        }

        const qrBox = document.getElementById('qr-code-box');
        qrBox.innerHTML = '<canvas id="qr-canvas"></canvas>';
        const canvas = document.getElementById('qr-canvas');

        await QRCode.toCanvas(canvas, data.qr_string, {
            width: 200,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });

        document.getElementById('modal-subtitle').innerText = "Awaiting your payment...";
        document.getElementById('qr-instructions').style.display = 'block';

        const txRef = doc(db, "ednotes_transaction", external_id);
        window.paymentListenerUnsubscribe = onSnapshot(txRef, (docSnap) => {
            if (docSnap.exists()) {
                const txData = docSnap.data();
                if (txData.status === "COMPLETED" || txData.status === "PAID") {
                    document.getElementById('qr-code-box').innerHTML = `
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                        <h3 style="color:#10b981; margin:0; font-size:20px;">Payment Successful!</h3>
                        <p style="font-size:14px; color:#666; margin-top:8px;">Your credits have been added to your balance.</p>
                    `;
                    document.getElementById('qr-instructions').style.display = 'none';
                    document.getElementById('modal-subtitle').innerText = "Thank you for your purchase.";
                    
                    if (window.paymentListenerUnsubscribe) {
                        window.paymentListenerUnsubscribe();
                        window.paymentListenerUnsubscribe = null;
                    }
                    setTimeout(() => closeCreditModal(), 3500);
                }
            }
        });
    } catch (error) {
        console.error(error);
        document.getElementById('qr-code-box').innerHTML = `
            <p style="color: red; font-size:14px; text-align:center;">Failed to generate QR Code.<br>${error.message}</p>
        `;
    }
}

// Close on Overlay click
document.getElementById('creditModal').addEventListener('click', function(e) {
    if(e.target === this) {
        closeCreditModal();
    }
});

// --- API Request Layer ---
const API_KEY = "sk-74Ra74RZRwlancETv9o16bkovOSGfoHl1zFgcza24oGid9q7";
const API_URL = "https://api.vectorengine.ai/v1/chat/completions"; 
const MODEL = "gemini-2.5-pro";

const fetchWithRetry = async (url, options, maxRetries = 6) => {
    let lastError;
    const reqBody = JSON.parse(options.body);

    const directOptions = {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: MODEL,
            messages: reqBody.messages,
            temperature: reqBody.temperature || 0.3,
            max_tokens: 32000
        })
    };

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(API_URL, directOptions);
            const data = await response.json();
            
            if (!response.ok || data.error) {
                const errMsg = data.error?.message || JSON.stringify(data.error) || `HTTP Error ${response.status}`;
                if (response.status === 429 || errMsg.includes('429') || errMsg.includes('saturated') || errMsg.includes('Too Many')) {
                    throw new Error(`API Rate Limit / Saturated: ${errMsg}`);
                }
                throw new Error(errMsg);
            }
            return data;
        } catch (err) {
            lastError = err;
            console.warn(`API call failed (Attempt ${i + 1}/${maxRetries}): ${err.message}`);
            if (i < maxRetries - 1 && (err.message.includes('Rate Limit') || err.message.includes('Saturated') || err.message.includes('fetch'))) {
                const delay = Math.pow(2, i) * 3000; 
                await new Promise(r => setTimeout(r, delay));
            } else {
                break; 
            }
        }
    }
    throw lastError;
};

// --- Generation Flow Control ---
export function closeConfirmModal() {
    const modal = document.getElementById('confirmDeductionModal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
}

export async function generateNotes() {
    const gradeLevelEl = document.getElementById('grade-level');
    const subjectFieldEl = document.getElementById('subject-field');
    const inputEl = document.getElementById('competency-input');
    
    const gradeLevel = gradeLevelEl.value;
    const subjectField = subjectFieldEl.value.trim();
    const competency = inputEl.value.trim();
    
    if (!gradeLevel || !subjectField) {
        alert("Please select both a Grade Level and a Subject.");
        return;
    }
    if (!competency) {
        alert("Please enter a learning competency first.");
        return;
    }

    if (window.currentEdNotesCredits === undefined || window.currentEdNotesCredits <= 0) {
        const zModal = document.getElementById('zeroCreditModal');
        zModal.style.display = 'flex';
        setTimeout(() => zModal.classList.add('active'), 10);
        return;
    }

    const confirmModal = document.getElementById('confirmDeductionModal');
    confirmModal.style.display = 'flex';
    setTimeout(() => confirmModal.classList.add('active'), 10);
}

export async function executeGeneration() {
    closeConfirmModal();

    const inputEl = document.getElementById('competency-input');
    const generateBtn = document.getElementById('generate-btn');
    const btnText = document.getElementById('btn-text');
    const loader = document.getElementById('loader');
    const outputSection = document.getElementById('output-section');
    const notesContent = document.getElementById('notes-content');
    
    const gradeLevelEl = document.getElementById('grade-level');
    const subjectFieldEl = document.getElementById('subject-field');
    
    const gradeLevel = gradeLevelEl.value;
    const subjectField = subjectFieldEl.value.trim();
    const competency = inputEl.value.trim();

    generateBtn.disabled = true;
    btnText.innerText = "Generating Notes...";
    loader.style.display = "block";
    outputSection.style.display = "none";
    notesContent.innerHTML = "";

    try {
        const userRef = doc(db, "users_ednotes", window.currentUser.uid);
        
        await setDoc(userRef, {
            ednotes_credits: increment(-1),
            used_credits: increment(1)
        }, { merge: true });

        const logRef = doc(db, "users_ednotes", window.currentUser.uid, "ednotes_logs", Date.now().toString());
        await setDoc(logRef, {
            action: `Generated Notes: ${subjectField} (${gradeLevel})`,
            credits_deducted: 1,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Credit deduction process failed:", err);
        alert("Failed to process credit deduction. Please check your network connection.");
        generateBtn.disabled = false;
        btnText.innerText = "Generate Lecture Notes";
        loader.style.display = "none";
        return;
    }

    const systemPrompt = `You are a Master Pedagogical Expert, Curriculum Writer, and Subject Matter Expert strictly adhering to the Philippine Department of Education (DepEd) standards. Your task is to generate 100% accurate, reliable, bulletproof, and EXTREMELY ENCYCLOPEDIC lecture notes perfectly tailored for ${gradeLevel} students in the subject of ${subjectField}. 

    *** CRITICAL: PEDAGOGY, TONE ALIGNMENT & DEPED COMPLIANCE ***
    - You MUST adjust your pedagogical approach, vocabulary, and explanation complexity to perfectly suit a ${gradeLevel} audience. The content MUST perfectly match the cognitive and developmental stage of this grade level based on the DepEd K to 12 / MATATAG Curriculum.
    - If it is for younger levels (e.g., Kinder, Primary), use highly accessible analogies, simple definitions, and highly visual/narrative examples, BUT maintain the massive required length by expanding heavily on stories, fundamental steps, and gentle repetitions.
    - If it is for High School or higher, use rigorous academic language and advanced critical thinking frameworks.
    - The subject is ${subjectField}. Frame ALL examples, contexts, and analytical lenses strictly through the rules, principles, and expected learning outcomes of this specific subject.
    - ZERO FACTUAL ERRORS: The lecture notes must be 100% factually accurate and reliable. You must only generate verified, universally accepted truths for the subject matter.

    *** CRITICAL: MASSIVE LENGTH & DEPTH MANDATE (STRICTLY MINIMUM 7 PAGES) ***
    - You MUST generate an exhaustive, master-level academic document that spans AT LEAST 7 PAGES (minimum 4,000 to 5,000+ words) in length, excluding the references section.
    - To achieve this immense length, you must structure the lecture notes with at least 8 to 10 major sections. Each section must contain extensive sub-sections, deep theoretical backgrounds, historical contexts, edge cases, common misconceptions, and advanced applications.
    - Every single concept must be treated like a full standalone chapter. Expand relentlessly. 
    
    *** CRITICAL: STRICT TOPIC ADHERENCE & DEPTH (NO SHORTCUTS) ***
    - You MUST stay 100% focused on the specific topic and learning competency provided. 
    - The lecture notes MUST be super detailed. You must exhaustively discuss ALL underlying sub-topics, theories, frameworks, and mechanisms inside the main topic. 
    - ABSOLUTELY NO BRIEF SUMMARIES OR ONE-LINERS. Every single definition, list item, and lesson discussion MUST be extensively elaborated into huge multi-paragraph deep dives. Explain the "what", "why", "how", "when", and "where" for every minor sub-point.
    - FORBIDDEN: Short, one-sentence explanations. If you list items, types, categories, or steps, EVERY SINGLE ITEM in that list MUST have a massive, comprehensive explanation. Unpack and elaborate fully so that a complete beginner leaves with absolute mastery.
    - Do not leave any related concept unexplained. If a concept relies on a foundational theory, explain that foundational theory in full detail first.
    - STRICT NO-MATH RULE FOR NON-MATH SUBJECTS: If the topic is about English, Communication, Reading, Writing, or Humanities, you are STRICTLY FORBIDDEN from generating mathematical formulas, pseudo-equations, or forced scientific logic. Only use math if the subject inherently and officially requires it.

    *** LOCALIZATION & CURRENCY (MANDATORY) ***
    - ALL real-world examples MUST be localized to the Philippines (use Filipino names, Philippine cities, local business contexts, historical events, etc.).
    - NEVER use the dollar sign ($) for currency. You are STRICTLY FORBIDDEN from using the $ sign to represent money. 
    - ALL monetary values MUST use the Philippine Peso symbol (₱). Example: ₱500, ₱10,000. 
    - This is a critical technical requirement because the $ symbol is exclusively reserved for triggering LaTeX math rendering. Using $ for money will corrupt the mathematical formulas and crash the text formatter.
    
    Formatting Rules:
    - Organize it like a highly detailed, comprehensive textbook chapter.
    - Start with a clear Title representing the topic.
    - Explanations must be exhaustive. Define ALL important terminologies, words, phrases, parts, and types relevant to the topic in dedicated terminology sections.
    - MANDATORY EXAMPLES FOR EVERYTHING: Provide AT LEAST FIVE (5) massively detailed, multi-paragraph real-world examples for EVERY core concept AND EVERY sub-point. If you introduce a list (e.g., 4 types of deductions), EACH item in that list must have 5 detailed examples. Do not skip examples for anything. Expand on the narrative and context of each example.
    - FLAWLESS EXAMPLE REASONING: For each example, you MUST provide a highly logical, precise, and explicitly contextualized explanation as to WHY the example works. The reasoning MUST directly and tightly connect back to the exact definition being discussed. Do not provide vague, disjointed, or unrelated reasoning. Explain the implications and outcomes of the example.
    - EXHAUSTIVE STEP-BY-STEP BREAKDOWNS: Whenever an equation, formula, or calculation is presented, you MUST meticulously explain where EVERY SINGLE NUMBER, CONSTANT, AND VARIABLE came from. Do not skip steps. Explain the rationale behind every step. NEVER leave the reader guessing how a specific mathematical value, step, or substitution was derived. Elaborate fully on the "why" and "how".
    - Use proper Markdown formatting (Headers #, ##, ###, bullet points, bolding for emphasis, and tables if applicable). Use highly nested structures to maximize length and organization.
    - Keep the tone academic, authoritative, accessible, and highly structured.
    
    *** REFERENCES (MANDATORY & PRIORITIZED) ***
    - At the very end of the page, you MUST include a "References" section.
    - TOP PRIORITY DEPED MATERIALS: You MUST explicitly prioritize and cite 100% accurate, real official Teaching Guides (TG), Curriculum Guides (CG), Learner's Materials (LM), or documents from the DepEd Learning Resource Management and Development System (LRMDS).
    - ZERO HALLUCINATION POLICY: Provide ONLY 100% accurate, real, and verifiable academic references, textbooks, or authoritative sources (in APA format) that support the lecture notes. You are STRICTLY FORBIDDEN from making up fake authors, fake book titles, or fake links. If you are unsure of a specific DepEd module's exact title, cite the official general DepEd Curriculum Guide for the subject and grade level instead of fabricating a module name.
    
    *** MATHEMATICAL FORMATTING RULES (CRITICAL) ***
    1. ALL mathematical expressions, equations, calculations, and formulas MUST be written in LaTeX.
    2. ALWAYS wrap LaTeX in single dollar signs ($) for inline math, and double dollar signs ($$) for block math. Example: $x$, $y = mx + b$.
    3. If an equation includes calculations, you MUST wrap the ENTIRE equation in dollar signs. Example: $40 \\times 20 = 800$. Do NOT leave raw LaTeX commands like \\times outside of the dollar signs.
    4. If an equation includes currency, place the peso symbol OUTSIDE the math block. Example: ₱$500 \\times 2 = 1000$.
    5. FORBIDDEN UNICODE: NEVER use raw superscript characters (x², x³) or raw inequality symbols (≥, ≤, ≠). ALWAYS use pure LaTeX ($x^2$, $x^3$, \\geq, \\leq, \\neq).`;

    const payload = {
        model: MODEL,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Grade Level: ${gradeLevel}\nSubject: ${subjectField}\nLearning Competency:\n"${competency}"\n\nTask: Create highly detailed, encyclopedic lecture notes perfectly aligned with the official DepEd curriculum and explicitly tailored for a ${gradeLevel} ${subjectField} class.\n\nRemember: You MUST physically force the generation of AT LEAST 7 PAGES (minimum 4,000+ words). To do this, meticulously expand every single concept and perfectly follow the 10-point mandatory outline. Provide at least 5 deep, multi-paragraph real-world Philippine examples per sub-topic perfectly suited for the cognitive level of a ${gradeLevel} student.\n\nCRITICAL: You ALWAYS MUST end the lecture notes with a rigorous Practice Test containing a MINIMUM OF 5 ITEMS strictly based on evaluating this learning competency for ${gradeLevel}, followed by a 100% accurate Answer Key with detailed explanations. Make sure ALL facts and referenced DepEd materials are 100% true, accurate, and reliable without any hallucination.` }
        ],
        temperature: 0.1
    };

    try {
        const data = await fetchWithRetry("SECURE_PROXY", {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        let rawMarkdown = data.choices[0].message.content;

        // --- LaTeX Sanitization Engine ---
        const cleanLaTeX = (raw) => {
            if (!raw) return "";
            let s = raw.toString();
            
            s = s.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (match, inner) => {
                return "\\begin{cases}" + inner.replace(/\\\\/g, "@@ROWBREAK@@") + "\\end{cases}";
            });

            s = s.replace(/\\\\/g, "\\");
            s = s.replace(/\brac\b/g, "frac");
            s = s.replace(/\bbegincases\b/g, "begin{cases}");
            s = s.replace(/\bendcases\b/g, "end{cases}");
            s = s.replace(/\binfinity\b/g, "infty");
            
            s = s.replace(/\bightarrow\b/g, "\\rightarrow");
            s = s.replace(/\beftarrow\b/g, "\\leftarrow");
            s = s.replace(/\bightleftarrow\b/g, "\\leftrightarrow");
            s = s.replace(/\bmathbb\s*\{?([A-Z])\}?\b/g, "\\mathbb{$1}");

            s = s.replace(/\\?arrow\s+([a-zA-Z])\b/g, "\\overrightarrow{$1}");
            s = s.replace(/\\?arrow\b/g, "\\rightarrow");

            s = s.replace(/\b([A-Z]{1,4})\s*(?:→|->|⟶)/g, "\\overrightarrow{$1}");
            s = s.replace(/(?:→|->|⟶)\s*([A-Z]{2,4})(?![a-zA-Z])/g, "\\overrightarrow{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*(?:↔|<->|⟷)/g, "\\overleftrightarrow{$1}");
            s = s.replace(/(?:↔|<->|⟷)\s*([A-Z]{2,4})(?![a-zA-Z])/g, "\\overleftrightarrow{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*(?:←|<-|⟵)/g, "\\overleftarrow{$1}");
            s = s.replace(/(?:←|<-|⟵)\s*([A-Z]{2,4})(?![a-zA-Z])/g, "\\overleftarrow{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*\\(rightarrow|to)(?![A-Za-z])/g, "\\overrightarrow{$1}");
            s = s.replace(/\\(rightarrow|to)\s*([A-Z]{2,4})(?![A-Za-z])/g, "\\overrightarrow{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*\\leftrightarrow(?![A-Za-z])/g, "\\overleftrightarrow{$1}");
            s = s.replace(/\\leftrightarrow\s*([A-Z]{2,4})(?![A-Za-z])/g, "\\overleftrightarrow{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*\\leftarrow(?![A-Za-z])/g, "\\overleftarrow{$1}");
            s = s.replace(/\\leftarrow\s*([A-Z]{2,4})(?![A-Za-z])/g, "\\overleftarrow{$1}");
            s = s.replace(/\\(leftrightarrow|overleftrightarrow)\s*_\{?([A-Z]{2,4})\}?/g, "\\overleftrightarrow{$1}");
            s = s.replace(/\\(rightarrow|overrightarrow|to)\s*_\{?([A-Z]{2,4})\}?/g, "\\overrightarrow{$1}");
            s = s.replace(/\\(leftarrow|overleftarrow)\s*_\{?([A-Z]{2,4})\}?/g, "\\overleftarrow{$1}");
            s = s.replace(/\\(bar|overline)\s*_\{?([A-Z]{2,4})\}?/g, "\\overline{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*\^\{?\s*[-−]\s*\}?/g, "\\overline{$1}");
            s = s.replace(/\b([A-Z]{1,4})\s*(?:⁻|¯|—|−)/g, "\\overline{$1}");
            s = s.replace(/(?:⁻|¯|—|−)\s*([A-Z]{2,4})(?![a-zA-Z])/g, "\\overline{$1}");

            s = s.replace(/([A-Z]{1,4})[\u0304\u0305]+/g, "\\overline{$1}");
            s = s.replace(/([A-Z]{1,4})[\u20D7]+/g, "\\overrightarrow{$1}");
            s = s.replace(/([A-Z]{1,4})[\u20E1\u034D]+/g, "\\overleftrightarrow{$1}");

            s = s.replace(/\b([A-Z]{1,4})\s*\\(overline|bar|vec|overrightarrow|overleftrightarrow|overleftarrow)(?![A-Za-z])/g, "\\$2{$1}");
            s = s.replace(/\\(overleftrightarrow|overrightarrow|overleftarrow|vec|bar|overline|hat|widehat|tilde|widetilde|dot|ddot|acute|grave|breve|check)\s*([A-Z0-9]{1,4})\b/ig, "\\$1{$2}");

            s = s.replace(/\(\^\\?\s*circ\)/g, "°");
            s = s.replace(/\^\\?\s*circ/g, "°");
            s = s.replace(/\^\{\\?\s*circ\}/g, "°");
            s = s.replace(/\\circ/g, "°");
            s = s.replace(/\bmathcal([A-Za-z0-9])\b/g, "\\mathcal{$1}");

            s = s.replace(/\\left/g, "").replace(/\\right/g, "")
                 .replace(/\\binom\s*\{([^}]+)\}\s*\{([^}]+)\}/g, "C($1, $2)")
                 .replace(/\\mathcal\s*\{?([a-zA-Z])\}?/g, (m, p1) => {
                     const map = { R: 'ℛ', Z: 'ℤ', N: 'ℕ', Q: 'ℚ', C: 'ℂ', l: 'ℓ' };
                     return map[p1] || p1;
                 })
                 .replace(/\\prime/g, "′").replace(/'''/g, "‴").replace(/''/g, "″").replace(/'/g, "′");

            s = s.replace(/@@ROWBREAK@@/g, "\\\\");
            return s;
        };

        rawMarkdown = cleanLaTeX(rawMarkdown);

        rawMarkdown = rawMarkdown.replace(/\$([^\$]+)\$/g, (match, inner) => {
            return '$' + inner.replace(/_/g, '\\_') + '$';
        });

        rawMarkdown = rawMarkdown.replace(/^(#\s+.*)$/m, `$1\n\n<div style="font-size: 14px; color: #444; font-weight: bold; margin-top: -16px;">Subject: ${subjectField} | Target: ${gradeLevel}</div>\n<div style="font-size: 13px; color: #555; font-style: italic; margin-top: 4px; margin-bottom: 24px;">Learning Competency: ${competency}</div>\n\n`);

        notesContent.innerHTML = marked.parse(rawMarkdown);

        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(notesContent, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ],
                    throwOnError: false,
                    output: 'htmlAndMathml', 
                });
            } catch(e) {
                console.warn("KaTeX render error:", e);
            }
        }

        outputSection.style.display = "flex";
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error(error);
        alert("Error generating notes: " + error.message);
    } finally {
        generateBtn.disabled = false;
        btnText.innerText = "Generate Lecture Notes";
        loader.style.display = "none";
    }
}

export function downloadPDF() {
    setTimeout(() => {
        window.print();
    }, 150);
}

// --- Admin Dashboard Controller ---
export async function openAdminModal() {
    const modal = document.getElementById('adminModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    
    document.getElementById('admin-loader').style.display = 'block';
    document.getElementById('admin-table-wrapper').style.display = 'none';
    const tbody = document.getElementById('admin-table-body');
    tbody.innerHTML = '';

    try {
        const usersSnap = await getDocs(collection(db, "users_ednotes"));
        usersSnap.forEach(doc => {
            const data = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.email || 'N/A'}</strong></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="number" id="edit-credits-${data.uid}" value="${data.ednotes_credits || 0}" style="width: 70px; padding: 6px; border: 1.5px solid var(--border-color); border-radius: 6px; font-family: var(--font-family); font-weight: 600; color: #10b981; outline: none;">
                        <button class="save-credit-btn" data-uid="${data.uid}" data-email="${data.email}" style="background: var(--primary-color); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">Save</button>
                    </div>
                </td>
                <td style="color: #ef4444; font-weight: 600;">${data.used_credits || 0}</td>
                <td><button class="log-btn" data-uid="${data.uid}" data-email="${data.email}">View Logs</button></td>
            `;
            tbody.appendChild(tr);
        });
        
        tbody.querySelectorAll('.save-credit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                updateUserCredits(e.target.dataset.uid, e.target.dataset.email);
            });
        });
        tbody.querySelectorAll('.log-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                viewAdminLogs(e.target.dataset.uid, e.target.dataset.email);
            });
        });

        document.getElementById('admin-loader').style.display = 'none';
        document.getElementById('admin-table-wrapper').style.display = 'block';
    } catch (err) {
        console.error("Admin user directory fetching error:", err);
        alert("Failed to fetch users. Validate Firestore rules.");
    }
}

export function closeAdminModal() {
    const modal = document.getElementById('adminModal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
}

export async function viewAdminLogs(uid, email) {
    const modal = document.getElementById('adminLogsModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    
    document.getElementById('log-user-email').innerText = `Activity Logs: ${email}`;
    document.getElementById('log-loader').style.display = 'block';
    document.getElementById('log-list-wrapper').style.display = 'none';
    const list = document.getElementById('log-list');
    list.innerHTML = '';

    try {
        const q = query(
            collection(db, "users_ednotes", uid, "ednotes_logs"),
            orderBy("timestamp", "desc"),
            limit(10)
        );
        const logsSnap = await getDocs(q);
        
        if (logsSnap.empty) {
            list.innerHTML = '<li style="padding: 12px; color: #666; text-align: center;">No activity recorded yet.</li>';
        } else {
            logsSnap.forEach(doc => {
                const l = doc.data();
                const dateStr = new Date(l.timestamp).toLocaleString();
                const color = l.credits_added ? '#10b981' : (l.credits_deducted ? '#ef4444' : '#666');
                const sign = l.credits_added ? '+' : (l.credits_deducted ? '-' : '');
                const amount = l.credits_added || l.credits_deducted || '';
                
                list.innerHTML += `
                    <li style="padding: 12px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between;">
                        <div>
                            <strong style="color: #111;">${l.action}</strong><br>
                            <span style="color: #666; font-size: 11px;">${dateStr}</span>
                        </div>
                        <div style="color: ${color}; font-weight: 700; display: flex; align-items: center;">
                            ${amount ? sign + amount + ' CR' : ''}
                        </div>
                    </li>
                `;
            });
        }
        document.getElementById('log-loader').style.display = 'none';
        document.getElementById('log-list-wrapper').style.display = 'block';
    } catch (err) {
        console.error("Logs Fetch Error:", err);
        list.innerHTML = '<li style="color: red; padding: 12px; text-align: center;">Failed to load logs.</li>';
        document.getElementById('log-loader').style.display = 'none';
        document.getElementById('log-list-wrapper').style.display = 'block';
    }
}

export async function updateUserCredits(uid, email) {
    const inputEl = document.getElementById(`edit-credits-${uid}`);
    const newCredits = Number(inputEl.value);
    
    if (isNaN(newCredits) || newCredits < 0) {
        alert("Please enter a valid positive number.");
        return;
    }

    const originalBg = inputEl.style.backgroundColor;
    inputEl.style.backgroundColor = '#fef08a';

    try {
        const userRef = doc(db, "users_ednotes", uid);
        await setDoc(userRef, {
            ednotes_credits: newCredits
        }, { merge: true });

        const logRef = doc(db, "users_ednotes", uid, "ednotes_logs", Date.now().toString());
        await setDoc(logRef, {
            action: `Admin manually adjusted balance to ${newCredits}`,
            credits_added: newCredits,
            timestamp: new Date().toISOString()
        });

        inputEl.style.backgroundColor = '#dcfce7'; 
        setTimeout(() => inputEl.style.backgroundColor = originalBg, 1500);
    } catch (err) {
        console.error("Failed to write manual updates:", err);
        alert("Error updating credits. Confirm Firestore permissions.");
        inputEl.style.backgroundColor = '#fee2e2'; 
    }
}

export function closeAdminLogsModal() {
    const modal = document.getElementById('adminLogsModal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
}

// Bind methods globally to ensure backwards HTML attribute call compliance
window.openCreditModal = openCreditModal;
window.closeCreditModal = closeCreditModal;
window.resetModalView = resetModalView;
window.purchasePlan = purchasePlan;
window.generateNotes = generateNotes;
window.executeGeneration = executeGeneration;
window.closeConfirmModal = closeConfirmModal;
window.downloadPDF = downloadPDF;
window.openAdminModal = openAdminModal;
window.closeAdminModal = closeAdminModal;
window.viewAdminLogs = viewAdminLogs;
window.updateUserCredits = updateUserCredits;
window.closeAdminLogsModal = closeAdminLogsModal;

// --- Lottie Animation Instantiation ---
const ednotesLogoData = {"v":"5.7.8","fr":15,"ip":0,"op":30,"w":500,"h":500,"nm":"Lottie_Layered","ddd":0,"assets":[],"layers":[{"ddd":0,"ind":1,"ty":4,"nm":"1 Outlines","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":1,"k":[{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":0,"s":[248.66900000000004,282.222,0],"to":[0,-12.333,0],"ti":[0,12.333,0]},{"t":10.0000004073083,"s":[248.66900000000004,208.222,0]}],"ix":2,"l":2},"a":{"a":0,"k":[109.012,49.209,0],"ix":1,"l":2},"s":{"a":0,"k":[100,100,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ind":0,"ty":"sh","ix":1,"ks":{"a":0,"k":{"i":[[7.221,2.947],[0,0],[-13.723,5.6],[0,0],[-7.221,-2.947],[0,0],[13.723,-5.6],[0,0]],"o":[[0,0],[-13.723,-5.6],[0,0],[7.221,-2.947],[0,0],[13.723,5.6],[0,0],[-7.221,2.947]],"v":[[-11.825,46.012],[-95.039,12.056],[-95.039,-12.055],[-11.825,-46.011],[11.825,-46.011],[95.039,-12.055],[95.039,12.056],[11.825,46.012]],"c":true},"ix":2},"nm":"Path 1","mn":"ADBE Vector Shape - Group","hd":false},{"ty":"fl","c":{"a":0,"k":[0, 0.6352941176470588, 0.9098039215686274, 1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[109.012,49.209],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Group 1","np":2,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":30.0000012219251,"st":0,"bm":0},{"ddd":0,"ind":2,"ty":4,"nm":"2 Outlines","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":1,"k":[{"i":{"x":0.667,"y":1},"o":{"x":0.333,"y":0},"t":0,"s":[248.66900000000004,301.951,0],"to":[0,-6.167,0],"ti":[0,6.167,0]},{"t":10.0000004073083,"s":[248.66900000000004,264.951,0]}],"ix":2,"l":2},"a":{"a":0,"k":[108.768,29.479,0],"ix":1,"l":2},"s":{"a":0,"k":[100,100,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ind":0,"ty":"sh","ix":1,"ks":{"a":0,"k":{"i":[[8.788,6.313],[1.802,-0.736],[0,0],[7.222,2.947],[0,0],[1.329,0.955],[-11.919,-4.865],[0,0],[-7.222,2.947],[0,0]],"o":[[-1.329,0.955],[0,0],[-7.222,2.947],[0,0],[-1.802,-0.736],[-8.788,6.313],[0,0],[7.222,2.947],[0,0],[11.92,-4.865]],"v":[[99.73,-29.23],[95.039,-26.673],[11.826,7.283],[-11.826,7.283],[-95.04,-26.673],[-99.73,-29.23],[-95.04,-7.674],[-11.826,26.283],[11.826,26.283],[95.039,-7.674]],"c":true},"ix":2},"nm":"Path 1","mn":"ADBE Vector Shape - Group","hd":false},{"ty":"fl","c":{"a":0,"k":[0, 0.6352941176470588, 0.9098039215686274, 1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[108.769,29.48],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Group 1","np":2,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":30.0000012219251,"st":0,"bm":0},{"ddd":0,"ind":3,"ty":4,"nm":"3 Outlines","sr":1,"ks":{"o":{"a":0,"k":100,"ix":11},"r":{"a":0,"k":0,"ix":10},"p":{"a":0,"k":[248.66900000000004,301.951,0],"ix":2,"l":2},"a":{"a":0,"k":[108.768,29.479,0],"ix":1,"l":2},"s":{"a":0,"k":[100,100,100],"ix":6,"l":2}},"ao":0,"shapes":[{"ty":"gr","it":[{"ind":0,"ty":"sh","ix":1,"ks":{"a":0,"k":{"i":[[8.788,6.313],[1.802,-0.737],[0,0],[7.222,2.947],[0,0],[1.329,0.955],[-11.919,-4.865],[0,0],[-7.222,2.947],[0,0]],"o":[[-1.329,0.955],[0,0],[-7.222,2.947],[0,0],[-1.802,-0.737],[-8.788,6.313],[0,0],[7.222,2.947],[0,0],[11.92,-4.865]],"v":[[99.73,-29.23],[95.039,-26.673],[11.826,7.283],[-11.826,7.283],[-95.04,-26.673],[-99.73,-29.23],[-95.04,-7.674],[-11.826,26.283],[11.826,26.283],[95.039,-7.674]],"c":true},"ix":2},"nm":"Path 1","mn":"ADBE Vector Shape - Group","hd":false},{"ty":"fl","c":{"a":0,"k":[0, 0.6352941176470588, 0.9098039215686274, 1],"ix":4},"o":{"a":0,"k":100,"ix":5},"r":1,"bm":0,"nm":"Fill 1","mn":"ADBE Vector Graphic - Fill","hd":false},{"ty":"tr","p":{"a":0,"k":[108.769,29.479],"ix":2},"a":{"a":0,"k":[0,0],"ix":1},"s":{"a":0,"k":[100,100],"ix":3},"r":{"a":0,"k":0,"ix":6},"o":{"a":0,"k":100,"ix":7},"sk":{"a":0,"k":0,"ix":4},"sa":{"a":0,"k":0,"ix":5},"nm":"Transform"}],"nm":"Group 1","np":2,"cix":2,"bm":0,"ix":1,"mn":"ADBE Vector Group","hd":false}],"ip":0,"op":30.0000012219251,"st":0,"bm":0}]};

lottie.loadAnimation({
    container: document.getElementById('ednotes-lottie-logo'),
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: ednotesLogoData
});
