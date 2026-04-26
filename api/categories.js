const app = require( "express" )();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require("@seald-io/nedb");
const async = require( "async" );


app.use( bodyParser.json() );

module.exports = app;

 
const paths = require("./path-helper");
let categoryDB = new Datastore( {
    filename: paths.dbPath("categories"),
    autoload: true
} );

categoryDB.count({}, (err, count) => {
    if (count === 0) {
        const hardwareId = 101;
        const refillId = 102;
        const liquidId = 103;

        const categories = [
            { _id: hardwareId, name: "Hardware", parentId: null },
            { _id: refillId, name: "Refill", parentId: null },
            { _id: liquidId, name: "Liquid", parentId: null },
            { _id: 104, name: "Devices", parentId: hardwareId },
            { _id: 105, name: "Coils", parentId: hardwareId }
        ];

        categoryDB.insert(categories);
    }
});


categoryDB.ensureIndex({ fieldName: '_id', unique: true });
app.get( "/", function ( req, res ) {
    res.send( "Category API" );
} );


  
app.get( "/all", function ( req, res ) {
    categoryDB.find( {}, function ( err, docs ) {
        res.send( docs );
    } );
} );

 
app.post( "/category", function ( req, res ) {
    let newCategory = req.body;
    newCategory._id = Math.floor(Date.now() / 1000); 
    newCategory.parentId = req.body.parentId || null;
    categoryDB.insert( newCategory, function ( err, category) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );



app.delete( "/category/:categoryId", function ( req, res ) {
    categoryDB.remove( {
        _id: parseInt(req.params.categoryId)
    }, function ( err, numRemoved ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );

 

 
app.put( "/category", function ( req, res ) {
    categoryDB.update( {
        _id: parseInt(req.body.id)
    }, req.body, {}, function (
        err,
        numReplaced,
        category
    ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
});



 