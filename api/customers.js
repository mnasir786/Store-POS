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



 