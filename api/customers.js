const app = require( "express" )();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require("@seald-io/nedb");
const async = require( "async" );
const ledgerService = require("./customer-ledger-service");

app.use( bodyParser.json() );

module.exports = app;


const paths = require("./path-helper");
let customerDB = new Datastore( {
    filename: paths.dbPath("customers"),
    autoload: true
} );

let customerPaymentsDB = new Datastore( {
    filename: paths.dbPath("customer_payments"),
    autoload: true
} );

let customerLedgerDB = new Datastore( {
    filename: paths.dbPath("customer_ledger"),
    autoload: true
} );

app.db = customerDB;
app.paymentsDb = customerPaymentsDB;
app.ledgerDb = customerLedgerDB;


customerDB.ensureIndex({ fieldName: '_id', unique: true });

function normalizeCustomerName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveCustomerQuery(customerId) {
    const query = { $or: [{ _id: customerId }] };
    if (!isNaN(customerId)) {
        query.$or.push({ _id: parseInt(customerId) });
        query.$or.push({ _id: customerId.toString() });
    }
    return query;
}

function resolveCustomerReferenceQuery(fieldName, customerId) {
    const query = { $or: [{ [fieldName]: customerId }] };
    if (!isNaN(customerId)) {
        query.$or.push({ [fieldName]: parseInt(customerId) });
        query.$or.push({ [fieldName]: customerId.toString() });
    }
    return query;
}

function findCustomerById(customerId, callback) {
    customerDB.findOne(resolveCustomerQuery(customerId), callback);
}

function ensureUniqueCustomerName(name, excludingId, callback) {
    const normalizedName = normalizeCustomerName(name);
    customerDB.find({}, function(err, customers) {
        if (err) {
            callback(err);
            return;
        }

        const duplicate = (customers || []).find(customer => {
            if (excludingId != null && String(customer._id) === String(excludingId)) {
                return false;
            }

            return normalizeCustomerName(customer.name) === normalizedName;
        });

        callback(null, duplicate);
    });
}


app.get( "/", function ( req, res ) {
    res.send( "Customer API" );
} );


app.get( "/customer/:customerId", function ( req, res ) {
    if ( !req.params.customerId ) {
        res.status( 500 ).send( "ID field is required." );
    } else {
        customerDB.findOne( resolveCustomerQuery(req.params.customerId), function ( err, customer ) {
            res.send( customer );
        } );
    }
} );

 
app.get("/all", function(req, res) {
  console.log("API: Fetching all customers...");
  customerDB.find({}, function(err, docs) {
    res.send(docs);
  });
});

 
app.post( "/customer", function ( req, res ) {
    var newCustomer = req.body;
    newCustomer.name = String(newCustomer.name || '').trim();
    if (!newCustomer.name) {
        return res.status(400).send("Customer name is required.");
    }
    newCustomer.balance = newCustomer.balance || 0;
    ensureUniqueCustomerName(newCustomer.name, null, function(err, duplicate) {
        if (err) return res.status(500).send(err);
        if (duplicate) {
            return res.status(409).send("Customer name already exists. Please use a distinct name.");
        }

        customerDB.insert( newCustomer, function ( err, customer ) {
            if ( err ) res.status( 500 ).send( err );
            else res.sendStatus( 200 );
        } );
    });
} );



app.delete( "/customer/:customerId", function ( req, res ) {
    customerDB.remove( resolveCustomerQuery(req.params.customerId), { multi: false }, function ( err, numRemoved ) {
        if ( err ) return res.status( 500 ).send( err );
        if ( numRemoved === 0 ) return res.status( 404 ).send( "Customer not found." );
        res.sendStatus( 200 );
    } );
} );

 

 
app.put( "/customer", function ( req, res ) {
    let customerId = req.body._id;
    let customerPhone = req.body.phone;

    // 1. Try to find by _id (string or number)
    let query = { $or: [{ _id: customerId }] };

    if (!isNaN(customerId)) {
        query.$or.push({ _id: parseInt(customerId) });
        query.$or.push({ _id: customerId.toString() });
    }

    // 2. Fallback to phone number if ID fails
    if (customerPhone) {
        query.$or.push({ phone: customerPhone });
    }

    console.log("Attempting balance update for customer:", { query, body: req.body });

    // NeDB Rule: You cannot include _id in the $set object, even if it's the same.
    delete req.body._id;

    const performUpdate = function() {
        customerDB.update( query, { $set: req.body }, {}, function (
            err,
            numReplaced
        ) {
            console.log("Update result:", { err, numReplaced });
            if ( err ) {
                res.status( 500 ).send( err );
            } else if (numReplaced === 0) {
                res.status(404).send("Customer not found to update balance. Tried query: " + JSON.stringify(query));
            } else {
                res.sendStatus( 200 );
            }
        } );
    };

    if (req.body.name) {
        req.body.name = String(req.body.name).trim();
        if (!req.body.name) {
            return res.status(400).send("Customer name is required.");
        }

        ensureUniqueCustomerName(req.body.name, customerId, function(err, duplicate) {
            if (err) return res.status(500).send(err);
            if (duplicate) {
                return res.status(409).send("Customer name already exists. Please use a distinct name.");
            }
            performUpdate();
        });
        return;
    }

    performUpdate();
});


app.post( "/payment", function ( req, res ) {
    const { customerId, amount, note, received_by, received_by_id } = req.body;

    if (!customerId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).send("Valid customerId and positive amount are required.");
    }

    const paymentAmount = parseFloat(amount);

    findCustomerById(customerId, function(err, customer) {
        if (err) return res.status(500).send(err);
        if (!customer) return res.status(404).send("Customer not found.");

        const resolvedId = customer._id; // use the actual stored _id for all subsequent ops

        const currentBalance = parseFloat(customer.balance) || 0;
        const newBalance = Math.round((currentBalance - paymentAmount) * 100) / 100;

        customerDB.update({ _id: resolvedId }, { $set: { balance: newBalance } }, {}, function(err2, numReplaced) {
            if (err2) return res.status(500).send(err2);
            if (numReplaced === 0) return res.status(404).send("Customer not found during update.");

            const paymentRecord = {
                _id: Date.now() + '_' + resolvedId,
                customerId: resolvedId,
                customerName: customer.name,
                amount: paymentAmount,
                balance_before: currentBalance,
                balance_after: newBalance,
                note: note || "",
                received_by: received_by || "unknown",
                received_by_id: received_by_id || 0,
                created_at: new Date().toJSON()
            };

            customerPaymentsDB.insert(paymentRecord, function(err3) {
                if (err3) console.error("Failed to save payment audit record:", err3);
                res.sendStatus(200);
            });
        });
    });
});


app.get( "/payments/:customerId", function( req, res ) {
    customerPaymentsDB.find(resolveCustomerReferenceQuery('customerId', req.params.customerId), function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

app.post("/ledger-entry", function(req, res) {
    const {
        customerId,
        entryType,
        amount,
        note,
        reference,
        effectiveAt,
        createdBy,
        createdById
    } = req.body || {};

    if (!customerId) {
        return res.status(400).send("Customer is required.");
    }

    findCustomerById(customerId, async function(err, customer) {
        if (err) return res.status(500).send(err);
        if (!customer) return res.status(404).send("Customer not found.");

        try {
            const entry = await ledgerService.recordManualLedgerEntry(customerDB, customerLedgerDB, customer, {
                entryType,
                amount,
                note,
                reference,
                effectiveAt,
                createdBy,
                createdById
            });
            res.send({
                entry,
                balance: entry.balance_after
            });
        } catch (error) {
            res.status(400).send(error.message || 'Could not save ledger entry.');
        }
    });
});

app.get("/ledger/:customerId/statement", function(req, res) {
    findCustomerById(req.params.customerId, function(err, customer) {
        if (err) return res.status(500).send(err);
        if (!customer) return res.status(404).send("Customer not found.");

        async.parallel({
            transactions(callback) {
                require("./transactions").db.find({}, callback);
            },
            payments(callback) {
                customerPaymentsDB.find(resolveCustomerReferenceQuery('customerId', customer._id), callback);
            },
            manualEntries(callback) {
                customerLedgerDB.find(resolveCustomerReferenceQuery('customerId', customer._id), callback);
            }
        }, function(loadError, results) {
            if (loadError) return res.status(500).send(loadError);

            const statement = ledgerService.buildCustomerStatement({
                customer,
                transactions: results.transactions || [],
                payments: results.payments || [],
                manualEntries: results.manualEntries || []
            });

            res.send(statement);
        });
    });
});
