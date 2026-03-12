const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Use environment variable for security
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;
const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';

router.post('/chat', async (req, res) => {
    if (!MOONSHOT_API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }
    
    try {
        const { messages, temperature = 0.7 } = req.body;
        
        const response = await fetch(`${MOONSHOT_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MOONSHOT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'kimi-k2-5',
                messages: messages,
                temperature: temperature,
                max_tokens: 2000
            })
        });
        
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Kimi Error:', error);
        res.status(500).json({ error: 'AI Brain connection failed' });
    }
});

module.exports = router;