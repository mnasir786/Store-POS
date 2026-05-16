const app = require( "express" )();
const server = require( "http" ).Server( app );
const bodyParser = require( "body-parser" );
const Datastore = require("@seald-io/nedb");
const async = require( "async" );
const fileUpload = require('express-fileupload');
const multer = require("multer");
const fs = require('fs');


const paths = require("./path-helper");
const storage = multer.diskStorage({
    destination: paths.uploadDir,
    filename: function(req, file, callback){
        callback(null, Date.now() + '.jpg'); // 
    }
});


let upload = multer({storage: storage});

app.use(bodyParser.json());


module.exports = app;

 
let inventoryDB = new Datastore( {
    filename: paths.dbPath("inventory"),
    autoload: true
} );

let stockAdjustmentsDB = new Datastore( {
    filename: paths.dbPath("stock_adjustments"),
    autoload: true
} );

app.db = inventoryDB;

inventoryDB.ensureIndex({ fieldName: '_id', unique: true });

 
app.get( "/", function ( req, res ) {
    res.send( "Inventory API" );
} );


 
app.get( "/product/:productId", function ( req, res ) {
    if ( !req.params.productId ) {
        res.status( 500 ).send( "ID field is required." );
    } else {
        inventoryDB.findOne( {
            _id: parseInt(req.params.productId)
        }, function ( err, product ) {
            res.send( product );
        } );
    }
} );


 
app.get( "/products", function ( req, res ) {
    console.log("API: Fetching all products...");
    inventoryDB.find( {}, function ( err, docs ) {
        res.send( docs );
    } );
} );


app.get( "/attributes", function ( req, res ) {
    inventoryDB.find( {}, function ( err, docs ) {
        let attributes = {
            brands: [...new Set(docs.map(item => item.brand).filter(Boolean))],
            models: [...new Set(docs.map(item => item.model).filter(Boolean))],
            flavors: [...new Set(docs.map(item => item.flavor).filter(Boolean))],
            sizes: [...new Set(docs.map(item => item.size).filter(Boolean))],
            nicotine: [...new Set(docs.map(item => item.nicotine).filter(Boolean))]
        };
        res.send( attributes );
    } );
} );


 
app.post( "/product", upload.single('imagename'), function ( req, res ) {

    let image = '';

    if(req.body.img != "") {
        image = req.body.img;        
    }

    if(req.file) {
        image = req.file.filename;  
    }
 

    if(req.body.remove == 1) {
        const path = './resources/app/public/uploads/product_image/'+ req.body.img;
        try {
          fs.unlinkSync(path)
        } catch(err) {
          console.error(err)
        }

        if(!req.file) {
            image = '';
        }
    }
    
    let Product = {
        _id: parseInt(req.body.id),
        price: req.body.price,
        category: req.body.category,
        quantity: parseInt(req.body.quantity) || 0,
        name: req.body.name,
        stock: req.body.stock == "on" ? 0 : 1,
        img: image,
        brand: req.body.brand || "",
        model: req.body.model || "",
        flavor: req.body.flavor || "",
        size: req.body.size || "",
        nicotine: req.body.nicotine || "",
        purchase_price: req.body.purchase_price || 0,
        min_stock: parseInt(req.body.min_stock) || 0,
        barcode: (req.body.barcode || "").trim(),
        price_per_ml: parseFloat(req.body.price_per_ml) || 0
    }

    if(req.body.id == "") {
        Product._id = Date.now();
        inventoryDB.insert( Product, function ( err, product ) {
            if ( err ) res.status( 500 ).send( err );
            else res.send( product );
        });
    }
    else { 
        inventoryDB.update( {
            _id: parseInt(req.body.id)
        }, Product, {}, function (
            err,
            numReplaced,
            product
        ) {
            if ( err ) res.status( 500 ).send( err );
            else res.sendStatus( 200 );
        } );

    }

});



 
app.delete( "/product/:productId", function ( req, res ) {
    inventoryDB.remove( {
        _id: parseInt(req.params.productId)
    }, function ( err, numRemoved ) {
        if ( err ) res.status( 500 ).send( err );
        else res.sendStatus( 200 );
    } );
} );

 

app.post("/products/bulk", async function(req, res) {
    const products = req.body;
    if (!Array.isArray(products) || products.length === 0)
        return res.status(400).send("Products array required.");

    const now = Date.now();
    const toInsert = products.map((p, i) => ({
        _id: now + i,
        name: p.name || "",
        price: p.price,
        category: p.category,
        quantity: parseInt(p.quantity) || 0,
        stock: p.stock !== undefined ? parseInt(p.stock) : 1,
        img: "",
        brand: p.brand || "",
        model: p.model || "",
        flavor: p.flavor || "",
        size: p.size || "",
        nicotine: p.nicotine || "",
        purchase_price: parseFloat(p.purchase_price) || 0,
        min_stock: parseInt(p.min_stock) || 0,
        barcode: (p.barcode || "").trim(),
        price_per_ml: parseFloat(p.price_per_ml) || 0
    }));

    let inserted = 0;
    const errors = [];
    for (const prod of toInsert) {
        try {
            await new Promise((resolve, reject) => {
                inventoryDB.insert(prod, (err) => err ? reject(err) : resolve());
            });
            inserted++;
        } catch (err) {
            errors.push({ name: prod.name, error: err.message });
        }
    }
    res.send({ inserted, failed: errors.length, errors });
});

app.put("/products/bulk", function(req, res) {
    const updates = req.body;
    if (!Array.isArray(updates) || updates.length === 0)
        return res.status(400).send("Updates array required.");

    const ALLOWED_FIELDS = new Set(["price", "purchase_price", "min_stock"]);
    let updated = 0;
    const promises = updates.map(u => {
        const field = u.field;
        if (!ALLOWED_FIELDS.has(field)) return Promise.resolve();
        const val = field === "min_stock" ? (parseInt(u.value) || 0) : (parseFloat(u.value) || 0);
        return new Promise((resolve) => {
            inventoryDB.update({ _id: parseInt(u._id) }, { $set: { [field]: val } }, {}, (err, n) => {
                if (!err) updated += n;
                resolve();
            });
        });
    });
    Promise.all(promises).then(() => res.send({ updated }));
});

app.post( "/product/sku", function ( req, res ) {
    const code = (req.body.skuCode || "").trim();
    const numericId = parseInt(code, 10);
    // Match by manufacturer barcode (string) first, then fall back to internal _id
    const query = isNaN(numericId)
        ? { barcode: code }
        : { $or: [{ barcode: code }, { _id: numericId }] };

    inventoryDB.findOne(query, function (err, product) {
        res.send(product || {});
    });
} );

 


app.post( "/adjust", function ( req, res ) {
    const { productId, adjustment, reason, user_id } = req.body;
    const adj = parseInt(adjustment);

    if (!productId || isNaN(adj)) {
        return res.status(400).send("productId and integer adjustment are required.");
    }

    inventoryDB.findOne({ _id: parseInt(productId) }, function(err, product) {
        if (err) return res.status(500).send(err);
        if (!product) return res.status(404).send("Product not found.");

        const newQty = (parseInt(product.quantity) || 0) + adj;
        if (newQty < 0) return res.status(400).send("Adjustment would result in negative stock.");

        inventoryDB.update({ _id: parseInt(productId) }, { $set: { quantity: newQty } }, {}, function(err2) {
            if (err2) return res.status(500).send(err2);

            const adjustmentRecord = {
                _id: Math.floor(Date.now() / 1000).toString() + '_adj',
                productId: parseInt(productId),
                productName: product.name,
                adjustment: adj,
                quantity_before: parseInt(product.quantity) || 0,
                quantity_after: newQty,
                reason: reason || "",
                user_id: user_id || 0,
                created_at: new Date().toJSON()
            };

            stockAdjustmentsDB.insert(adjustmentRecord, function(err3) {
                if (err3) console.error("Failed to save adjustment record:", err3);
                res.send({ newQuantity: newQty });
            });
        });
    });
});

app.decrementInventory = function ( products ) {

    async.eachSeries( products, function ( transactionProduct, callback ) {
        inventoryDB.findOne( {
            _id: parseInt(transactionProduct.id)
        }, function (
            err,
            product
        ) {
    
            if ( !product ) {
                callback();
            } else if ( Number.parseInt(product.stock, 10) !== 1 ) {
                callback();
            } else {
                let updatedQuantity =
                    parseInt( product.quantity) -
                    parseInt( transactionProduct.quantity );

                if ( updatedQuantity < 0 ) {
                    return callback(new Error(`Insufficient stock for product: ${product.name}`));
                }

                inventoryDB.update( {
                        _id: parseInt(product._id)
                    }, {
                        $set: {
                            quantity: updatedQuantity
                        }
                    }, {},
                    callback
                );
            }
        } );
    } );
};
