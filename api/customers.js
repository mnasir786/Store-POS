const app = require( "express" )();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require("@seald-io/nedb");
const async = require( "async" );

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

app.db = customerDB;


customerDB.ensureIndex({ fieldName: '_id', unique: true });


app.get( "/", function ( req, res ) {
    res.send( "Customer API" );
} );


app.get( "/customer/:customerId", function ( req, res ) {
    if ( !req.params.customerId ) {
        res.status( 500 ).send( "ID field is required." );
    } else {
        customerDB.findOne( {
            _id: req.params.customerId
        }, function ( err, customer ) {
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
    newCustomer.balance = newCustomer.balance || 0;
    customerDB.insert( newCustomer, function ( err, customer ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );



app.delete( "/customer/:customerId", function ( req, res ) {
    customerDB.remove( {
        _id: req.params.customerId
    }, function ( err, numRemoved ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
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
});


app.post( "/payment", function ( req, res ) {
    const { customerId, amount, note, received_by, received_by_id } = req.body;

    if (!customerId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).send("Valid customerId and positive amount are required.");
    }

    const paymentAmount = parseFloat(amount);

    // Customers may be stored with integer or string _id — try both
    const idQuery = { $or: [{ _id: customerId }] };
    if (!isNaN(customerId)) idQuery.$or.push({ _id: parseInt(customerId) });

    customerDB.findOne(idQuery, function(err, customer) {
        if (err) return res.status(500).send(err);
        if (!customer) return res.status(404).send("Customer not found.");

        const resolvedId = customer._id; // use the actual stored _id for all subsequent ops

        const currentBalance = parseFloat(customer.balance) || 0;
        if (paymentAmount > currentBalance) {
            return res.status(400).send("Payment amount exceeds outstanding balance.");
        }

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
    customerPaymentsDB.find({ customerId: req.params.customerId }, function(err, docs) {
        if (err) return res.status(500).send(err);
        res.send(docs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    });
});

