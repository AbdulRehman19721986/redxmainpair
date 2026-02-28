const express = require('express');
const cors = require('cors');
const pairCode = require('./pair');

const app = express();
const PORT = process.env.PORT || 8001;

// Allow requests from your InfinityFree domain
app.use(cors({
    origin: ['http://redxpair.gt.tc', 'https://redxpair.gt.tc', 'http://localhost'],
    optionsSuccessStatus: 200
}));

app.use('/code', pairCode);

app.get('/', (req, res) => {
    res.send('REDXBOT Pairing Backend is running.');
});

app.listen(PORT, () => {
    console.log(`✅ Backend server running on port ${PORT}`);
});
