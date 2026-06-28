const express = require('express');
const path = require('path');
const app = express();

// Hostinger dynamically assigns process.env.PORT to route traffic
const PORT = process.env.PORT || 3000;

// Serve the compiled, minified client files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback all routes to index.html to support single-page architecture if needed
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is operating on port ${PORT}`);
});
