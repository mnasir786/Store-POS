const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const bcrypt = require("bcryptjs");
const btoa = require("btoa");

app.use(bodyParser.json());
module.exports = app;

const paths = require("./path-helper");
let usersDB = new Datastore({
    filename: paths.dbPath("users"),
    autoload: true
});

usersDB.ensureIndex({ fieldName: '_id', unique: true });

const SALT_ROUNDS = 10;

function hashPassword(plain) {
    return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function verifyPassword(plain, stored) {
    // Try bcrypt first; fall back to legacy base64
    if (bcrypt.getRounds(stored).toString().length > 0) {
        try { return bcrypt.compareSync(plain, stored); } catch (_) {}
    }
    return stored === btoa(plain);
}

app.get("/", function(req, res) {
    res.send("Users API");
});

app.get("/user/:userId", function(req, res) {
    if (!req.params.userId) return res.status(500).send("ID field is required.");
    usersDB.findOne({ _id: parseInt(req.params.userId) }, function(err, doc) {
        res.send(doc);
    });
});

app.get("/logout/:userId", function(req, res) {
    if (!req.params.userId) return res.status(500).send("ID field is required.");
    usersDB.update({ _id: parseInt(req.params.userId) }, { $set: { status: 'Logged Out_' + new Date() } }, {}, function() {
        res.sendStatus(200);
    });
});

app.post("/login", function(req, res) {
    usersDB.findOne({ username: req.body.username }, function(err, user) {
        if (!user) return res.send(null);

        const plain = req.body.password;
        const stored = user.password;

        let passwordOk = false;
        // Try bcrypt first
        try {
            bcrypt.getRounds(stored); // throws if not a bcrypt hash
            passwordOk = bcrypt.compareSync(plain, stored);
        } catch (_) {
            // Legacy base64 password
            if (stored === btoa(plain)) {
                passwordOk = true;
                // Migrate to bcrypt silently
                usersDB.update({ _id: user._id }, { $set: { password: hashPassword(plain) } }, {});
            }
        }

        if (!passwordOk) return res.send(null);

        usersDB.update({ _id: user._id }, { $set: { status: 'Logged In_' + new Date() } }, {});
        res.send(user);
    });
});

app.get("/all", function(req, res) {
    usersDB.find({}, function(err, docs) {
        res.send(docs);
    });
});

app.delete("/user/:userId", function(req, res) {
    usersDB.remove({ _id: parseInt(req.params.userId) }, function(err, numRemoved) {
        if (err) return res.status(500).send(err);
        res.sendStatus(200);
    });
});

app.post("/post", function(req, res) {
    const plain = req.body.password;
    const passwordField = plain ? hashPassword(plain) : undefined;

    let User = {
        username: req.body.username,
        fullname: req.body.fullname,
        perm_products: req.body.perm_products == "on" ? 1 : 0,
        perm_categories: req.body.perm_categories == "on" ? 1 : 0,
        perm_transactions: req.body.perm_transactions == "on" ? 1 : 0,
        perm_users: req.body.perm_users == "on" ? 1 : 0,
        perm_settings: req.body.perm_settings == "on" ? 1 : 0,
        status: ""
    };

    if (req.body.id == "") {
        if (!plain) return res.status(400).send("Password is required for new users.");
        User._id = Math.floor(Date.now() / 1000);
        User.password = passwordField;
        usersDB.insert(User, function(err, user) {
            if (err) return res.status(500).send(err);
            res.send(user);
        });
    } else {
        let updateFields = {
            username: req.body.username,
            fullname: req.body.fullname,
            perm_products: req.body.perm_products == "on" ? 1 : 0,
            perm_categories: req.body.perm_categories == "on" ? 1 : 0,
            perm_transactions: req.body.perm_transactions == "on" ? 1 : 0,
            perm_users: req.body.perm_users == "on" ? 1 : 0,
            perm_settings: req.body.perm_settings == "on" ? 1 : 0
        };
        if (plain) updateFields.password = passwordField;

        usersDB.update({ _id: parseInt(req.body.id) }, { $set: updateFields }, {}, function(err) {
            if (err) return res.status(500).send(err);
            res.sendStatus(200);
        });
    }
});

app.get("/check", function(req, res) {
    usersDB.findOne({ username: "admin" }, function(err, doc) {
        if (!doc) {
            usersDB.findOne({ _id: 1 }, function(err, id1) {
                let User = {
                    username: "admin",
                    password: hashPassword("admin"),
                    fullname: "Administrator",
                    perm_products: 1,
                    perm_categories: 1,
                    perm_transactions: 1,
                    perm_users: 1,
                    perm_settings: 1,
                    status: ""
                };
                User._id = id1 ? Math.floor(Date.now() / 1000) : 1;
                usersDB.insert(User, function() {});
            });
        }
    });
});
