const express = require('express');

server = express();

server.get('/', (req, res) => {
    res.json('helloword!');
})

server.listen(4444, () => {
    console.log('listen');
})