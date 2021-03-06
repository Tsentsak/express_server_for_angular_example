"use strict";
const express = require("express");
const compression = require("compression");
const request = require("request");
const mcache = require('memory-cache');

const _environment = process.env.ENVIRONMENT || 'develop';
const _bucketAddress = 'http://static.test.com.s3-website-eu-west-1.amazonaws.com';
const _apiAddress = 'https://testapi/api/example/sitemap';
const _port = 4100;

const app = express();
app.use(compression());

// ---- MEMORY CACHE ---- //
const cache = {
    getCache: () => {
        return (req, res, next) => {
            let key = '__express__' + req.originalUrl;
            let cachedBody = mcache.get(key);
            if (cachedBody) {
                res.type(cachedBody.headers['content-type']);
                res.send(cachedBody.body);
            } else {
                next()
            }
        }
    },

    handleResponse: (req, res, url) => {
        request(url, function (error, response) {
            let key = '__express__' + req.originalUrl;
            mcache.put(key, response, 120000); //2 min
        }).pipe(res);
    }
};

// ---- LIMIT FOR TOO MANY CONNECTIONS ---- //
if (_environment === 'production') {
    const rateLimit = require("express-rate-limit");
    const limiter = rateLimit({
        windowMs: 10000,
        max: 200,
        message: "Too many requests from this IP, please try again"
    });
    app.use(limiter);
}

// ---- REDIRECT TO HTTPS ---- //
if (_environment === 'production') {
    app.enable('trust proxy');
    app.use(function (req, res, next) {
        if (req.secure) {
            next(); // request was via https, so do no special handling
        } else {
            res.redirect(301, 'https://' + req.headers.host + req.url); // request was via http, so redirect to https
        }
    });
}

// ---- REDIRECT NON-WWW REQUESTS ---- //
if (_environment === 'production') {
    app.get('/*', function (req, res, next) {
        if (req.headers.host.match(/^www/) == null) {
            // req.headers.host = "www." + req.headers.host;
            res.redirect('https://www.' + req.headers.host + req.url);
        } else {
            next();
        }
    });
}

// ---- SERVE SITEMAPS.XML FROM A DEDICATED API ---- //
app.all('*.xml', cache.getCache(), function (req, res) {
    // we need to redirect the sitemap request directly to the backend
    const options = {
        url: _apiAddress + req.url,
        headers: {
            'Accept': 'application/xml'
        }
    };
    request(options).pipe(res);
});

// ---- SERVE STATIC FILES FROM A BUCKET ---- //
app.all('*.(js|css|ttf|svg|png|jpg|jpeg|ico|woff2|woff|txt|html)', cache.getCache(), function (req, res) {
    const url = _bucketAddress + req.url;
    cache.handleResponse(req, res, url);
});

// ---- SERVE APLICATION PATHS FROM A BUCKET ---- //
app.all('*', cache.getCache(), function (req, res) {
    cache.handleResponse(req, res, _bucketAddress);
});

// ---- START UP THE NODE SERVER  ----
app.listen(_port, function () {
    console.log("Node Express server for " + app.name + " listening on https://localhost:" + _port);
});
