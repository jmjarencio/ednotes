const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

// Serve public static assets from the 'dist' folder
app.use(express.static(path.join(__dirname, 'dist')));

// Handle navigation routes
app.get('*', (req, res) => {
    // If the request points to a file (has an extension like .js, .css, .png), 
    // do not fall back to index.html. Return a proper 404.
    if (path.extname(req.path)) {
        return res.status(404).send('Asset Not Found');
    }
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is operating on port ${PORT}`);
});
