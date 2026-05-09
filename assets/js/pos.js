let cart = [];
let index = 0;
let allUsers = [];
let allProducts = [];
let allCategories = [];
let allTransactions = [];
let sold = [];
let state = [];
let sold_items = [];
let item;
let auth;
let holdOrder = 0;
let vat = 0;
let perms = null;
let deleteId = 0;
let paymentType = 0;
let receipt = '';
let totalVat = 0;
let subTotal = 0;
let method = '';
let order_index = 0;
let user_index = 0;
let product_index = 0;
let transaction_index;
let host = 'localhost';
let path = require('path');
let port = '8001';
let moment = require('moment');
let Swal = require('sweetalert2');
let { ipcRenderer } = require('electron');
let dotInterval = setInterval(function () { $(".dot").text('.') }, 3000);
const electron = require('electron');
electron.remote = require('@electron/remote');
let Store = require('electron-store');
const app = electron.remote.app;
let img_path = app.getPath('appData') + '/POS/uploads/';
let api = 'http://' + host + ':' + port + '/api/';
let btoa = require('btoa');
const { jsPDF } = require('jspdf');
let html2canvas = require('html2canvas');
let JsBarcode = require('jsbarcode');
let macaddress = require('macaddress');
let categories = [];
let holdOrderList = [];
let customerOrderList = [];
let ownUserEdit = null;
let totalPrice = 0;
let orderTotal = 0;
let auth_error = 'Incorrect username or password';
let auth_empty = 'Please enter a username and password';
let holdOrderlocation = $("#randerHoldOrders");
let customerOrderLocation = $("#randerCustomerOrders");
let storage = new Store();
let settings;
let platform;
let user = {};
let start = moment().startOf('month');
let end = moment().endOf('day');
let start_date = start.toISOString();
let end_date = end.toISOString();
let by_till = 0;
let by_user = 0;
let by_status = 1;


let mlConfig = { liquid_product_id: null, price_per_ml: 0 };

function getMlForPrice(price) {
    if (!mlConfig || !(mlConfig.price_per_ml > 0)) return -1;
    return Math.round(parseFloat(price) / mlConfig.price_per_ml);
}

function cb(start, end) {
    $('#reportrange span').html(start.format('MMMM D, YYYY') + ' - ' + end.format('MMMM D, YYYY'));
}


$(function() {
    $('#reportrange').daterangepicker({
        startDate: start,
        endDate: end,
        autoApply: true,
        timePicker: true,
        timePicker24Hour: true,
        timePickerIncrement: 10,
        timePickerSeconds: true,
        // minDate: '',
        ranges: {
            'Today': [moment().startOf('day'), moment()],
            'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
            'Last 7 Days': [moment().subtract(6, 'days').startOf('day'), moment().endOf('day')],
            'Last 30 Days': [moment().subtract(29, 'days').startOf('day'), moment().endOf('day')],
            'This Month': [moment().startOf('month'), moment().endOf('month')],
            'This Month': [moment().startOf('month'), moment()],
            'Last Month': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')]
        }
    }, cb);

    cb(start, end);
});




$.fn.serializeObject = function () {
    var o = {};
    var a = this.serializeArray();
    $.each(a, function () {
        if (o[this.name]) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
        } else {
            o[this.name] = this.value || '';
        }
    });
    return o;
};


auth = storage.get('auth');
user = storage.get('user');


if (auth == undefined) {
    $.get(api + 'users/check/', function (data) { });
    $("#loading").show();
    authenticate();

} else {

    $('#loading').show();

    setTimeout(function () {
        $('#loading').hide();
    }, 2000);

    platform = storage.get('settings');

    if (platform != undefined) {

        if (platform.app == 'Network Point of Sale Terminal') {
            api = 'http://' + platform.ip + ':' + port + '/api/';
            perms = true;
        }
    }

    if (user && user._id) {
        $.get(api + 'users/user/' + user._id, function (data) {
            user = data;
            $('#loggedin-user').text(user.fullname);
        });
    }


    $.get(api + 'settings/get', function (data) {
        settings = data.settings;
    });

    $.get(api + 'settings/ml-config', function(data) {
        if (data) mlConfig = data;
    });


    $.get(api + 'users/all', function (users) {
        allUsers = [...users];
    });



    $(document).ready(function () {
        console.log("POS: Document Ready - Initializing...");

        $.fn.addToCart = function (id, count, stock) {
            if (stock == 1) {
                if (count <= 0) {
                    Swal.fire(
                        'Out of Stock',
                        'This product is currently out of stock',
                        'warning'
                    );
                    return;
                }
            }

            let product = allProducts.filter(function (selected) {
                return selected._id == id;
            });

            let item = cart.filter(function (selected) {
                return selected.id == id;
            });

            if (item.length > 0) {
                if (stock == 1) {
                    if (item[0].qty >= count) {
                        Swal.fire(
                            'Out of Stock',
                            'You have already added all the available stock.',
                            'warning'
                        );
                        return;
                    }
                }
                item[0].qty++;
            }
            else {
                cart.push({
                    id: id,
                    product: product[0].name,
                    qty: 1,
                    price: product[0].price
                });
            }

            renderCart();
        }


        // 1. Define all $.fn and global functions FIRST
        $.fn.viewCustomerHistory = function (id, name) {
            $('#ledgerModal').modal('hide');
            $('#customer_history_name').text(name + " - Account History");
            let history_list = '';

            $.when(
                $.get(api + 'all'),
                $.get(api + 'customers/payments/' + id)
            ).done(function(txRes, pmtRes) {
                let transactions = txRes[0] || [];
                let payments = pmtRes[0] || [];

                let rows = [];

                transactions.filter(t => t.customer && t.customer.id == id).forEach(t => {
                    let balanceChange = '';
                    if (t.payment_type == 'On Account') {
                        balanceChange = `<span class="text-danger">+${settings.symbol}${parseFloat(t.total).toFixed(2)}</span>`;
                    }
                    rows.push({
                        date: t.date,
                        ref: t.order,
                        description: t.payment_type == 'On Account' ? 'Sale (On Account)' : 'Sale (' + t.payment_type + ')',
                        amount: settings.symbol + parseFloat(t.total).toFixed(2),
                        balanceChange: balanceChange || 'N/A'
                    });
                });

                payments.forEach(p => {
                    rows.push({
                        date: p.created_at,
                        ref: '-',
                        description: 'Payment Received' + (p.note ? ': ' + p.note : ''),
                        amount: settings.symbol + parseFloat(p.amount).toFixed(2),
                        balanceChange: `<span class="text-success">-${settings.symbol}${parseFloat(p.amount).toFixed(2)}</span>`
                    });
                });

                rows.sort((a, b) => new Date(b.date) - new Date(a.date));
                rows.forEach(row => {
                    history_list += `<tr>
                        <td>${moment(row.date).format('YYYY-MM-DD HH:mm')}</td>
                        <td>${row.ref}</td>
                        <td>${row.description}</td>
                        <td>${row.amount}</td>
                        <td>${row.balanceChange}</td>
                    </tr>`;
                });

                $('#customer_history_list').html(history_list || '<tr><td colspan="5">No records found.</td></tr>');
                $('#customerHistoryModal').modal('show');
            });
        }

        $.fn.payCustomerBalance = function (id, name, balance, phone) {
            $('#ledgerModal').modal('hide');
            Swal.fire({
                title: 'Receive Payment: ' + name,
                html: 'Outstanding Balance: <b>' + settings.symbol + parseFloat(balance).toFixed(2) + '</b>',
                input: 'text',
                inputPlaceholder: 'Enter amount received',
                showCancelButton: true,
                confirmButtonText: 'Confirm Payment',
                onOpen: () => {
                    setTimeout(() => {
                        const input = Swal.getInput();
                        if (input) { input.focus(); input.select(); }
                    }, 300);
                },
                inputValidator: (value) => {
                    const amt = parseFloat(value);
                    if (!value || isNaN(amt) || amt <= 0) return 'Please enter a valid amount greater than 0';
                    if (amt > parseFloat(balance)) return 'Amount cannot exceed outstanding balance of ' + settings.symbol + parseFloat(balance).toFixed(2);
                }
            }).then((result) => {
                if (result.value) {
                    let amount = parseFloat(result.value);
                    $.ajax({
                        url: api + 'customers/payment',
                        type: 'POST',
                        data: JSON.stringify({
                            customerId: id,
                            amount: amount,
                            note: '',
                            received_by: user.fullname,
                            received_by_id: user._id
                        }),
                        contentType: 'application/json',
                        success: function () {
                            loadLedger();
                            loadCustomers();
                            Swal.fire('Payment Received', 'Payment of ' + settings.symbol + amount.toFixed(2) + ' recorded for ' + name, 'success');
                        },
                        error: function (xhr) {
                            Swal.fire('Error', xhr.responseText || 'Could not record payment.', 'error');
                        }
                    });
                }
            });
        }


        // 1. Define all functions FIRST (Hoisting Safety)
        window.loadCustomers = function () {
            console.log("POS: loadCustomers() started...");
            $.get(api + 'customers/all', function (customers) {
                console.log("POS: loadCustomers received data:", customers.length, "customers");
                $('#customer').html(`<option value="0" selected="selected">Walk in customer</option>`);
                customers.forEach(cust => {
                    let customer = `<option value='{"id": "${cust._id}", "name": "${cust.name}"}'>${cust.name}</option>`;
                    $('#customer').append(customer);
                });
            }).fail(function(err) { console.error("POS: loadCustomers FAILED:", err); });
        }

        window.loadLedger = function () {
            console.log("POS: loadLedger() started...");
            $.get(api + 'customers/all', function (customers) {
                console.log("POS: loadLedger received data:", customers.length, "customers");
                let ledger_list = '';
                $('#ledger_list').empty();
                customers.forEach(customer => {
                    if (customer.balance != 0) {
                        ledger_list += `<tr>
                            <td>${customer.name}</td>
                            <td>${customer.phone}</td>
                            <td>${(settings && settings.symbol ? settings.symbol : '')}${parseFloat(customer.balance).toFixed(2)}</td>
                            <td>
                                <button onclick="$(this).viewCustomerHistory('${customer._id}', '${customer.name}')" class="btn btn-info btn-sm">History</button>
                                <button onclick="$(this).payCustomerBalance('${customer._id}', '${customer.name}', ${customer.balance}, '${customer.phone}')" class="btn btn-success btn-sm">Pay</button>
                            </td>
                        </tr>`;
                    }
                });
                $('#ledger_list').html(ledger_list);
            }).fail(function(err) { console.error("POS: loadLedger FAILED:", err); });
        }

        function loadProducts() {
            console.log("POS: loadProducts() started...");
            $.get(api + 'inventory/products', function (data) {
                console.log("POS: loadProducts received data:", data.length, "items");
                data.forEach(item => { item.price = parseFloat(item.price).toFixed(2); });
                allProducts = [...data];
                loadProductList();
                $('#parent').text('');
                $('#categories').html(`<button type="button" id="all" class="btn btn-categories btn-white waves-effect waves-light">All</button> `);
                data.forEach(item => {
                    if (!categories.includes(item.category)) { categories.push(item.category); }
                    const isLowStock = item.stock == 1 && parseInt(item.min_stock) > 0 && parseInt(item.quantity) <= parseInt(item.min_stock);
                    const lowStockBadge = isLowStock ? `<span style="background:#e74c3c;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;">LOW STOCK</span>` : '';
                    // Also add parent category class so clicking a parent filter button shows subcategory products
                    const catObj = allCategories.find(c => String(c._id) === String(item.category));
                    const parentClass = (catObj && catObj.parentId) ? ' ' + catObj.parentId : '';
                    let item_info = `<div class="col-lg-2 box ${item.category}${parentClass}" onclick="$(this).addToCart('${item._id}', ${parseInt(item.quantity) || 0}, ${parseInt(item.stock) || 0})"><div class="widget-panel widget-style-2 ${isLowStock ? 'border border-danger' : ''}"><div id="image"><img src="${item.img == "" ? "./assets/images/default.jpg" : img_path + item.img}" id="product_img" alt=""></div><div class="text-muted m-t-5 text-center"><div class="name" id="product_name">${item.name}</div><div class="brand" style="font-size: 10px; color: #999;">${item.brand || ''} ${item.model || ''}</div><div class="flavor" style="font-size: 10px; color: #777;">${item.flavor || ''} ${item.size || ''} ${item.nicotine || ''}</div><span class="sku">${item.barcode || item._id}</span><span class="stock">STOCK </span><span class="count">${item.stock == 1 ? item.quantity : 'N/A'}</span> ${lowStockBadge}</div><sp class="text-success text-center"><b data-plugin="counterup">${(settings && settings.symbol ? settings.symbol : '') + item.price}</b> </sp></div></div>`;
                    $('#parent').append(item_info);
                });
                categories.forEach(category => {
                    let c = allCategories.filter(function (ctg) { return ctg._id == category; });
                    $('#categories').append(`<button type="button" id="${category}" class="btn btn-categories btn-white waves-effect waves-light">${c.length > 0 ? c[0].name : ''}</button> `);
                });
            }).fail(function(err) { console.error("POS: loadProducts FAILED:", err); });
        }

        function loadCategories() {
            $.get(api + 'categories/all', function (data) {
                allCategories = data;
                loadCategoryList();

                const parents = data.filter(c => !c.parentId);
                const children = data.filter(c => c.parentId);

                // Product form: hierarchical optgroups so staff pick the right subcategory
                $('#category').html('<option value="0">Select Category</option>');
                parents.forEach(parent => {
                    const subs = children.filter(c => String(c.parentId) === String(parent._id));
                    if (subs.length > 0) {
                        let group = `<optgroup label="${parent.name}">`;
                        subs.forEach(s => { group += `<option value="${s._id}">&nbsp;&nbsp;${s.name}</option>`; });
                        group += '</optgroup>';
                        $('#category').append(group);
                    } else {
                        $('#category').append(`<option value="${parent._id}">${parent.name}</option>`);
                    }
                });

                // Parent picker (for adding new categories) stays flat
                $('#parentCategory').html('<option value="">None (top-level)</option>');
                data.forEach(c => {
                    $('#parentCategory').append(`<option value="${c._id}">${c.name}</option>`);
                });
            });
        }

        // Detect the type of a category by name (and parent name)
        function getProductCategoryType(catId) {
            const cat = allCategories.find(c => String(c._id) === String(catId));
            if (!cat) return 'other';
            const name = (cat.name || '').toLowerCase();
            const parent = allCategories.find(c => String(c._id) === String(cat.parentId));
            const parentName = parent ? (parent.name || '').toLowerCase() : '';
            if (name.includes('refill')) return 'refill';
            if (name.includes('liquid')) return 'liquid';
            if (name.includes('hardware') || name.includes('device') || name.includes('coil')
                || parentName.includes('hardware')) return 'hardware';
            return 'other';
        }

        // Show/hide product form sections based on selected category
        function applyProductCategoryUI(catId) {
            const type = getProductCategoryType(catId);

            // Reset all sections
            $('#hw-fields, #liq-fields, #brand-section, #refill-note, #price-per-ml-section').hide();
            $('#stock-section').show();
            $('#stock-section .input-group-addon').text('units');
            $('#barcode-section').show();
            $('#cat-type-badge').html('');
            $('#brand_label').text('Brand');
            $('#brand').attr('placeholder', 'Brand name');
            $('#price_label').html('Sale Price <span class="text-danger">*</span>');
            $('#purchase_price_label').text('Unit Cost Price (Purchase)');
            $('#purchase_price').attr('placeholder', 'Per Unit cost');

            if (type === 'hardware') {
                $('#brand-section').show();
                $('#hw-fields').show();
                $('#brand').attr('placeholder', 'e.g. SMOK, Vaporesso, Aspire');
                $('#cat-type-badge').html('<span class="label label-default"><i class="fa fa-microchip"></i> Hardware / Device</span>');
            } else if (type === 'liquid') {
                $('#brand-section').show();
                $('#liq-fields').show();
                $('#brand').attr('placeholder', 'e.g. Nasty, Dinner Lady, IVG');
                $('#cat-type-badge').html('<span class="label label-info"><i class="fa fa-tint"></i> E-Liquid</span>');
            } else if (type === 'refill') {
                $('#refill-note').show();
                $('#stock-section').show();
                $('#price-per-ml-section').show();
                // Switch quantity/min_stock units to ml for refill liquid tracking
                $('#stock-section .input-group-addon').text('ml');
                $('#price_label').html('Default Price (optional) <small class="text-muted">— staff enter actual amount at sale</small>');
                $('#purchase_price_label').text('Purchase Cost per ml');
                $('#purchase_price').attr('placeholder', 'e.g. 5.00 — what you pay per ml of liquid');
                $('#cat-type-badge').html('<span class="label label-warning"><i class="fa fa-tint"></i> Refill Service</span>');
                $('#barcode-section').hide();
            } else {
                // Unknown/other: show everything
                $('#brand-section').show();
                $('#hw-fields').show();
                $('#liq-fields').show();
            }
        }

        // Trigger when category dropdown changes
        $('#category').on('change', function() {
            applyProductCategoryUI($(this).val());
        });

        // Live ml preview in product form: Rs.200 ÷ price_per_ml = ml
        $('#price_per_ml').on('input', function() {
            const rate = parseFloat($(this).val());
            $('#ml_preview').text(rate > 0 ? Math.round(200 / rate) + ' ml' : '—');
        });

        // 2. Call the functions NOW that they are defined
        $(".loading").hide();
        console.log("POS: Triggering Data Loaders (High Priority)...");
        loadCategories();
        loadProducts();
        loadCustomers();
        loadLedger();




        if (settings && settings.symbol) {
            $("#price_curr, #payment_curr, #change_curr").text(settings.symbol);
        }


        setTimeout(function () {
            if (settings == undefined && auth != undefined) {
                $('#settingsModal').modal('show');
            }
            else if (settings) {
                vat = parseFloat(settings.percentage) || 0;
                $("#taxInfo").text(settings.charge_tax ? vat : 0);
            }

        }, 1500);



        $("#settingsModal").on("hide.bs.modal", function () {

            setTimeout(function () {
                // Only force-reopen on first run (no cached settings). Avoids spurious
                // reopens caused by the API response race condition on startup.
                const cachedSettings = storage.get('settings');
                if (settings == undefined && !cachedSettings && auth != undefined) {
                    $('#settingsModal').modal('show');
                }
            }, 1000);

        });


        if (0 == user.perm_products) { $(".p_one").hide() };
        if (0 == user.perm_categories) { $(".p_two").hide() };
        if (0 == user.perm_transactions) { $(".p_three").hide() };
        if (0 == user.perm_users) { $(".p_four").hide() };
        if (0 == user.perm_settings) { $(".p_five").hide() };


        function loadAttributes() {
            $.get(api + 'inventory/attributes', function (data) {
                $('#brand_list').empty();
                data.brands.forEach(item => $('#brand_list').append(`<option value="${item}">`));

                $('#model_list').empty();
                data.models.forEach(item => $('#model_list').append(`<option value="${item}">`));

                $('#flavor_list').empty();
                data.flavors.forEach(item => $('#flavor_list').append(`<option value="${item}">`));

                $('#size_list').empty();
                data.sizes.forEach(item => $('#size_list').append(`<option value="${item}">`));

                $('#nicotine_list').empty();
                data.nicotine.forEach(item => $('#nicotine_list').append(`<option value="${item}">`));
            });
        }

        function formatUserStatusTimestamp(rawValue) {
            if (!rawValue) {
                return '';
            }

            if (rawValue instanceof Date) {
                return moment(rawValue).format('hh:mm A DD MMM YYYY');
            }

            const parsedDate = new Date(rawValue);
            if (!Number.isNaN(parsedDate.getTime())) {
                return moment(parsedDate).format('hh:mm A DD MMM YYYY');
            }

            return '';
        }


        function loadUserList() {

            let counter = 0;
            let user_list = '';
            $('#user_list').empty();
            if ($.fn.DataTable.isDataTable('#userList')) $('#userList').DataTable().destroy();

            $.get(api + 'users/all', function (users) {



                allUsers = [...users];

                users.forEach((user, index) => {

                    state = [];
                    let class_name = '';

                    if (user.status != "") {
                        state = user.status.split("_");

                        switch (state[0]) {
                            case 'Logged In': class_name = 'btn-default';
                                break;
                            case 'Logged Out': class_name = 'btn-light';
                                break;
                        }
                    }

	                    counter++;
	                    user_list += `<tr>
	            <td>${user.fullname}</td>
	            <td>${user.username}</td>
	            <td class="${class_name}">${state.length > 0 ? state[0] : ''} <br><span style="font-size: 11px;"> ${state.length > 0 ? formatUserStatusTimestamp(state.slice(1).join('_')) : ''}</span></td>
	            <td>${user._id == 1 ? '<span class="btn-group"><button class="btn btn-dark"><i class="fa fa-edit"></i></button><button class="btn btn-dark"><i class="fa fa-trash"></i></button></span>' : '<span class="btn-group"><button onClick="$(this).editUser(' + index + ')" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteUser(\'' + user._id + '\')" class="btn btn-danger"><i class="fa fa-trash"></i></button></span>'}</td></tr>`;

                    if (counter == users.length) {

                        $('#user_list').html(user_list);

                        $('#userList').DataTable({
                            "order": [[1, "desc"]]
                            , "autoWidth": false
                            , "info": true
                            , "JQueryUI": true
                            , "ordering": true
                            , "paging": false
                        });
                    }

                });

            });
        }


        function loadProductList() {
            let products = [...allProducts];
            let product_list = '';
            let counter = 0;
            $('#product_list').empty();
            if ($.fn.DataTable.isDataTable('#productList')) $('#productList').DataTable().destroy();

            products.forEach((product, index) => {

                counter++;

                let category = allCategories.filter(function (category) {
                    return category._id == product.category;
                });


                product_list += `<tr>
            <td><img id="` + product._id + `"></td>
            <td><img style="max-height: 50px; max-width: 50px; border: 1px solid #ddd;" src="${product.img == "" ? "./assets/images/default.jpg" : img_path + product.img}" id="product_img"></td>
            <td>${product.name}<br><small>${product.brand || ''} ${product.flavor || ''} ${product.size || ''}</small></td>
            <td>${settings.symbol}${product.price}</td>
            <td>${product.stock == 1 ? product.quantity : 'N/A'}</td>
            <td>${category.length > 0 ? category[0].name : ''}</td>
            <td class="nobr"><span class="btn-group"><button onClick="$(this).editProduct(${index})" class="btn btn-warning btn-sm"><i class="fa fa-edit"></i></button>${product.stock == 1 ? `<button onClick="$(this).adjustStock('${product._id}', '${product.name.replace(/'/g, '').replace(/"/g, '')}', ${parseInt(product.quantity)||0})" class="btn btn-info btn-sm"><i class="fa fa-sliders"></i></button>` : ''}<button onClick="$(this).deleteProduct(\'${product._id}\')" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button></span></td></tr>`;

                if (counter == allProducts.length) {

                    $('#product_list').html(product_list);

                    products.forEach(pro => {
                        const barcodeVal = pro.barcode || String(pro._id);
                        $("#" + pro._id + "").JsBarcode(barcodeVal, {
                            width: 2,
                            height: 25,
                            fontSize: 14
                        });
                    });

                    $('#productList').DataTable({
                        "order": [[1, "desc"]]
                        , "autoWidth": false
                        , "info": true
                        , "JQueryUI": true
                        , "ordering": true
                        , "paging": false
                    });
                }

            });
        }


        function loadCategoryList() {
            $('#category_list').empty();
            if ($.fn.DataTable.isDataTable('#categoryList')) $('#categoryList').DataTable().destroy();

            // Show top-level categories first, then subcategories grouped under their parent
            const parents = allCategories.filter(c => !c.parentId);
            const children = allCategories.filter(c => c.parentId);
            const ordered = [];
            parents.forEach(p => {
                ordered.push({ cat: p, isChild: false });
                children.filter(c => String(c.parentId) === String(p._id)).forEach(c => {
                    ordered.push({ cat: c, isChild: true, parentName: p.name });
                });
            });
            // Any orphaned subcategories (parent deleted) at the end
            children.filter(c => !parents.find(p => String(p._id) === String(c.parentId))).forEach(c => {
                ordered.push({ cat: c, isChild: true, parentName: '?' });
            });

            let category_list = '';
            ordered.forEach(({ cat, isChild, parentName }, index) => {
                const origIndex = allCategories.indexOf(cat);
                const parentCell = isChild
                    ? `<span class="text-muted"><i class="fa fa-level-up fa-rotate-90" style="margin-right:4px;"></i>${parentName}</span>`
                    : `<span class="label label-default">Top-level</span>`;
                const nameDisplay = isChild
                    ? `<span style="padding-left:16px;"><i class="fa fa-angle-right text-muted" style="margin-right:4px;"></i>${cat.name}</span>`
                    : `<b>${cat.name}</b>`;
                category_list += `<tr>
                    <td>${nameDisplay}</td>
                    <td>${parentCell}</td>
                    <td><span class="btn-group"><button onClick="$(this).editCategory(${origIndex})" class="btn btn-warning btn-sm"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteCategory('${cat._id}')" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button></span></td>
                </tr>`;
            });

            $('#category_list').html(category_list);
            $('#categoryList').DataTable({
                "autoWidth": false,
                "info": true,
                "JQueryUI": true,
                "ordering": false,
                "paging": false
            });
        }


        $.fn.addToCart = function (id, count, stock) {

            if (stock == 1) {
                if (count > 0) {
                    $.get(api + 'inventory/product/' + id, (data) => {
                        $(this).addProductToCart(data);
                    });
                }
                else {
                    Swal.fire(
                        'Out of stock!',
                        'This item is currently unavailable',
                        'info'
                    );
                }
            }
            else {
                $.get(api + 'inventory/product/' + id, (data) => {
                    $(this).addProductToCart(data);
                });
            }

        };


        function barcodeSearch(e) {

            e.preventDefault();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
                $('<i>', { class: 'fa fa-spinner fa-spin' })
            );

            let req = {
                skuCode: $("#skuCode").val()
            }

            $.ajax({
                url: api + 'inventory/product/sku',
                type: 'POST',
                data: JSON.stringify(req),
                contentType: 'application/json; charset=utf-8',
                cache: false,
                processData: false,
                success: (data) => {

                    if (data._id != undefined && data.quantity >= 1) {
                        $(this).addProductToCart(data);
                        $("#searchBarCode").get(0).reset();
                        $("#basic-addon2").empty();
                        $("#basic-addon2").append(
                            $('<i>', { class: 'glyphicon glyphicon-ok' })
                        )
                    }
                    else if (data.quantity < 1) {
                        Swal.fire(
                            'Out of stock!',
                            'This item is currently unavailable',
                            'info'
                        );
                    }
                    else {

                        Swal.fire(
                            'Not Found!',
                            '<b>' + $("#skuCode").val() + '</b> is not a valid barcode!',
                            'warning'
                        );

                        $("#searchBarCode").get(0).reset();
                        $("#basic-addon2").empty();
                        $("#basic-addon2").append(
                            $('<i>', { class: 'glyphicon glyphicon-ok' })
                        )
                    }

                }, error: function (data) {
                    if (data.status === 422) {
                        $(this).showValidationError(data);
                        $("#basic-addon2").append(
                            $('<i>', { class: 'glyphicon glyphicon-remove' })
                        )
                    }
                    else if (data.status === 404) {
                        $("#basic-addon2").empty();
                        $("#basic-addon2").append(
                            $('<i>', { class: 'glyphicon glyphicon-remove' })
                        )
                    }
                    else {
                        $(this).showServerError();
                        $("#basic-addon2").empty();
                        $("#basic-addon2").append(
                            $('<i>', { class: 'glyphicon glyphicon-warning-sign' })
                        )
                    }
                }
            });

        }


        $("#searchBarCode").on('submit', function (e) {
            barcodeSearch(e);
        });



        $('body').on('click', '#jq-keyboard button', function (e) {
            let pressed = $(this)[0].className.split(" ");
            if ($("#skuCode").val() != "" && pressed[2] == "enter") {
                barcodeSearch(e);
            }
        });



        $.fn.addProductToCart = function (data) {
            item = {
                id: data._id,
                product_name: data.name,
                sku: data.sku,
                price: data.price,
                quantity: 1,
                category: data.category
            };

            let category = allCategories.filter(function (cat) {
                return cat._id == data.category;
            });

            if (category.length > 0 && category[0].name.toLowerCase() == 'refill') {
                Swal.fire({
                    title: 'Enter Refill Amount',
                    input: 'text',
                    inputPlaceholder: '0.00',
                    showCancelButton: true,
                    confirmButtonText: 'Add to Cart',
                    onOpen: () => {
                        setTimeout(() => {
                            const input = Swal.getInput();
                            if (input) {
                                input.focus();
                                input.select();
                            }
                        }, 500);
                    },
                    inputValidator: (value) => {
                        if (!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
                            return 'Please enter a valid amount greater than 0'
                        }
                    }
                }).then((result) => {
                    if (result.value) {
                        item.price = parseFloat(result.value);
                        const ml = getMlForPrice(item.price);
                        item.ml = ml >= 0 ? ml : 0;
                        item.liquid_product_id = mlConfig.liquid_product_id || null;
                        cart.push(item);
                        $(this).renderTable(cart);
                    }
                });
            } else {
                if ($(this).isExist(item)) {
                    $(this).qtIncrement(index);
                } else {
                    cart.push(item);
                    $(this).renderTable(cart)
                }
            }
        }


        $.fn.addRefillQuickAmount = function (amount) {
            let refillCat = allCategories.find(c => c.name.toLowerCase() === 'refill');
            let refillCatId = refillCat ? refillCat._id : '102';

            const doAdd = (price) => {
                const ml = getMlForPrice(price);
                const self = this;
                const pushIt = (resolvedMl) => {
                    let refillItem = {
                        id: 'refill_' + Date.now(),
                        product_name: 'Refill',
                        sku: '',
                        price: parseFloat(price),
                        quantity: 1,
                        category: refillCatId,
                        stock: 0,
                        ml: parseInt(resolvedMl) || 0,
                        liquid_product_id: mlConfig.liquid_product_id || null
                    };
                    cart.push(refillItem);
                    $(self).renderTable(cart);
                };
                if (ml >= 0) {
                    pushIt(ml);
                } else {
                    Swal.fire({
                        title: 'ML Dispensed?',
                        html: `Rs.${price} refill — how many ML?`,
                        input: 'number',
                        inputPlaceholder: 'e.g. 45',
                        showCancelButton: true,
                        confirmButtonText: 'Add to Cart',
                        onOpen: () => { setTimeout(() => { const i = Swal.getInput(); if (i) i.focus(); }, 200); },
                        inputValidator: v => (!v || parseInt(v) <= 0) ? 'Enter a valid ML amount' : null
                    }).then(r => { if (r.value) pushIt(r.value); });
                }
            };

            if (amount > 0) {
                doAdd(amount);
            } else {
                Swal.fire({
                    title: 'Enter Refill Amount',
                    input: 'text',
                    inputPlaceholder: '0.00',
                    showCancelButton: true,
                    confirmButtonText: 'Add to Cart',
                    onOpen: () => { setTimeout(() => { const inp = Swal.getInput(); if (inp) { inp.focus(); inp.select(); } }, 300); },
                    inputValidator: (value) => {
                        if (!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
                            return 'Please enter a valid amount greater than 0';
                        }
                    }
                }).then((result) => {
                    if (result.value) doAdd(result.value);
                });
            }
        };

        $.fn.isExist = function (data) {
            let toReturn = false;
            $.each(cart, function (index, value) {
                if (value.id == data.id) {
                    $(this).setIndex(index);
                    toReturn = true;
                }
            });
            return toReturn;
        }


        $.fn.setIndex = function (value) {
            index = value;
        }


        $.fn.calculateCart = function () {
            let total = 0;
            let grossTotal;
            $('#total').text(cart.length);
            $.each(cart, function (index, data) {
                total += data.quantity * data.price;
            });
            total = total - $("#inputDiscount").val();
            $('#price').text(settings.symbol + total.toFixed(2));

            subTotal = total;

            if ($("#inputDiscount").val() >= total) {
                $("#inputDiscount").val(0);
            }

            if (settings.charge_tax) {
                totalVat = ((total * vat) / 100);
                grossTotal = total + totalVat
            }

            else {
                grossTotal = total;
            }

            orderTotal = grossTotal.toFixed(2);

            $("#gross_price").text(settings.symbol + grossTotal.toFixed(2));
            $("#payablePrice").val(grossTotal);
        };



        $.fn.renderTable = function (cartList) {
            $('#cartTable > tbody').empty();
            $(this).calculateCart();
            $.each(cartList, function (index, data) {
                $('#cartTable > tbody').append(
                    $('<tr>').append(
                        $('<td>', { text: index + 1 }),
                        $('<td>').append(
                            $('<span>', { text: data.product_name }),
                            (parseInt(data.ml) > 0) ? $('<br>') : $(),
                            (parseInt(data.ml) > 0) ? $('<small>', { text: data.ml + ' ml', style: 'color:#888;font-size:11px;' }) : $()
                        ),
                        $('<td>').append(
                            $('<div>', { class: 'input-group' }).append(
                                $('<div>', { class: 'input-group-btn btn-xs' }).append(
                                    $('<button>', {
                                        class: 'btn btn-default btn-xs',
                                        onclick: '$(this).qtDecrement(' + index + ')'
                                    }).append(
                                        $('<i>', { class: 'fa fa-minus' })
                                    )
                                ),
                                $('<input>', {
                                    class: 'form-control',
                                    type: 'number',
                                    value: data.quantity,
                                    style: 'width: 60px !important; text-align: center;',
                                    onInput: '$(this).qtInput(' + index + ')'
                                }),
                                $('<div>', { class: 'input-group-btn btn-xs' }).append(
                                    $('<button>', {
                                        class: 'btn btn-default btn-xs',
                                        onclick: '$(this).qtIncrement(' + index + ')'
                                    }).append(
                                        $('<i>', { class: 'fa fa-plus' })
                                    )
                                )
                            )
                        ),
                        $('<td>', { text: settings.symbol + (data.price * data.quantity).toFixed(2) }),
                        $('<td>').append(
                            $('<button>', {
                                class: 'btn btn-danger btn-xs',
                                onclick: '$(this).deleteFromCart(' + index + ')'
                            }).append(
                                $('<i>', { class: 'fa fa-times' })
                            )
                        )
                    )
                )
            })
        };


        $.fn.deleteFromCart = function (index) {
            cart.splice(index, 1);
            $(this).renderTable(cart);

        }


        $.fn.qtIncrement = function (i) {

            item = cart[i];

            let product = allProducts.filter(function (selected) {
                return selected._id == parseInt(item.id);
            });

            if (product[0].stock == 1) {
                if (item.quantity < product[0].quantity) {
                    item.quantity += 1;
                    $(this).renderTable(cart);
                }

                else {
                    Swal.fire(
                        'No more stock!',
                        'You have already added all the available stock.',
                        'info'
                    );
                }
            }
            else {
                item.quantity += 1;
                $(this).renderTable(cart);
            }

        }


        $.fn.qtDecrement = function (i) {
            if (item.quantity > 1) {
                item = cart[i];
                item.quantity -= 1;
                $(this).renderTable(cart);
            }
        }


        $.fn.qtInput = function (i) {
            item = cart[i];
            item.quantity = $(this).val();
            $(this).renderTable(cart);
        }


        $.fn.cancelOrder = function () {

            if (cart.length > 0) {
                Swal.fire({
                    title: 'Are you sure?',
                    text: "You are about to remove all items from the cart.",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    confirmButtonText: 'Yes, clear it!'
                }).then((result) => {

                    if (result.value) {

                        cart = [];
                        $(this).renderTable(cart);
                        holdOrder = 0;

                        Swal.fire(
                            'Cleared!',
                            'All items have been removed.',
                            'success'
                        )
                    }
                });
            }

        }


        $("#payButton").on('click', function () {
            if (cart.length != 0) {
                $("#payablePrice").val(orderTotal);
                paymentType = 1;
                $(".list-group-item").removeClass('active');
                $("#cash").addClass('active');
                $("#confirmPayment").hide();
                $("#payment").val('');
                $("#change").text('');
                $("#paymentModel").modal('toggle');
            } else {
                Swal.fire(
                    'Oops!',
                    'There is nothing to pay!',
                    'warning'
                );
            }

        });


        $("#hold").on('click', function () {

            if (cart.length != 0) {

                $("#dueModal").modal('toggle');
            } else {
                Swal.fire(
                    'Oops!',
                    'There is nothing to hold!',
                    'warning'
                );
            }
        });


        function printJobComplete() {
            alert("print job complete");
        }


        $.fn.submitDueOrder = function (status) {

            let items = "";
            let payment = 0;

            cart.forEach(item => {

                items += "<tr><td>" + item.product_name + "</td><td>" + item.quantity + "</td><td>" + settings.symbol + parseFloat(item.price).toFixed(2) + "</td></tr>";

            });

            let currentTime = new Date(moment());

            let discount = $("#inputDiscount").val();
            let customer = JSON.parse($("#customer").val());
            let date = moment(currentTime).format("YYYY-MM-DD HH:mm:ss");
            let paid = $("#payment").val() == "" ? "" : parseFloat($("#payment").val()).toFixed(2);
            let change = $("#change").text() == "" ? "" : parseFloat($("#change").text()).toFixed(2);
            let refNumber = $("#refNumber").val();
            let orderNumber = holdOrder;
            let type = "";
            let tax_row = "";


            switch (paymentType) {
                case 1: type = "Cash"; break;
                case 2: type = "Cheque"; break;
                case 3: type = "Card"; break;
                case 4: type = "On Account"; break;
                default: type = "Cash";
            }


            if (paid != "") {
                payment = `<tr>
                        <td>Paid</td>
                        <td>:</td>
                        <td>${settings.symbol + paid}</td>
                    </tr>
                    <tr>
                        <td>Change</td>
                        <td>:</td>
                        <td>${settings.symbol + Math.abs(change).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td>Method</td>
                        <td>:</td>
                        <td>${type}</td>
                    </tr>`
            }



            if (settings.charge_tax) {
                tax_row = `<tr>
                    <td>Vat(${settings.percentage})% </td>
                    <td>:</td>
                    <td>${settings.symbol}${parseFloat(totalVat).toFixed(2)}</td>
                </tr>`;
            }



            if (status == 0) {

                if ($("#customer").val() == 0 && $("#refNumber").val() == "") {
                    Swal.fire(
                        'Reference Required!',
                        'You either need to select a customer <br> or enter a reference!',
                        'warning'
                    )

                    return;
                }
            }


            $(".loading").show();


            if (holdOrder != 0) {

                orderNumber = holdOrder;
                method = 'PUT'
            }
            else {
                orderNumber = Math.floor(Date.now() / 1000);
                method = 'POST'
            }


            receipt = `<div style="font-size: 10px;">                            
        <p style="text-align: center;">
        ${settings.img == "" ? settings.img : '<img style="max-width: 50px;max-width: 100px;" src ="' + img_path + settings.img + '" /><br>'}
            <span style="font-size: 22px;">${settings.store}</span> <br>
            ${settings.address_one} <br>
            ${settings.address_two} <br>
            ${settings.contact != '' ? 'Tel: ' + settings.contact + '<br>' : ''} 
            ${settings.tax != '' ? 'Vat No: ' + settings.tax + '<br>' : ''} 
        </p>
        <hr>
        <left>
            <p>
            Order No : ${orderNumber} <br>
            Ref No : ${refNumber == "" ? orderNumber : refNumber} <br>
            Customer : ${customer == 0 ? 'Walk in customer' : customer.name} <br>
            Cashier : ${user.fullname} <br>
            Date : ${date}<br>
            </p>

        </left>
        <hr>
        <table width="100%">
            <thead style="text-align: left;">
            <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
            </tr>
            </thead>
            <tbody>
            ${items}                
     
            <tr>                        
                <td><b>Subtotal</b></td>
                <td>:</td>
                <td><b>${settings.symbol}${subTotal.toFixed(2)}</b></td>
            </tr>
            <tr>
                <td>Discount</td>
                <td>:</td>
                <td>${discount > 0 ? settings.symbol + parseFloat(discount).toFixed(2) : ''}</td>
            </tr>
            
            ${tax_row}
        
            <tr>
                <td><h3>Total</h3></td>
                <td><h3>:</h3></td>
                <td>
                    <h3>${settings.symbol}${parseFloat(orderTotal).toFixed(2)}</h3>
                </td>
            </tr>
            ${payment == 0 ? '' : payment}
            </tbody>
            </table>
            <br>
            <hr>
            <br>
            <p style="text-align: center;">
             ${settings.footer}
             </p>
            </div>`;


            if (status == 3) {
                if (cart.length > 0) {

                    printJS({ printable: receipt, type: 'raw-html' });

                    $(".loading").hide();
                    return;

                }
                else {

                    $(".loading").hide();
                    return;
                }
            }


            let data = {
                order: orderNumber,
                ref_number: refNumber,
                discount: discount,
                customer: customer,
                status: status,
                subtotal: parseFloat(subTotal).toFixed(2),
                tax: totalVat,
                order_type: 1,
                items: cart,
                date: currentTime,
                payment_type: type,
                payment_info: $("#paymentInfo").val(),
                total: orderTotal,
                paid: paid,
                change: change,
                _id: orderNumber,
                till: platform ? platform.till : null,
                mac: platform ? platform.mac : null,
                user: user.fullname,
                user_id: user._id
            }


            $.ajax({
                url: api + 'new',
                type: method,
                data: JSON.stringify(data),
                contentType: 'application/json; charset=utf-8',
                cache: false,
                processData: false,
                success: function (data) {

                    cart = [];
                    holdOrder = 0;
                    $('#viewTransaction').html('');
                    $('#viewTransaction').html(receipt);
                    $('#orderModal').modal('show');
                    loadProducts();
                    loadCustomers();
                    $(".loading").hide();
                    $("#dueModal").modal('hide');
                    $("#paymentModel").modal('hide');
                    $(this).getHoldOrders();
                    $(this).getCustomerOrders();
                    $(this).renderTable(cart);

                }, error: function (data) {
                    $(".loading").hide();
                    $("#dueModal").modal('toggle');
                    Swal.fire(
                        'Could not save order',
                        data && data.responseText ? data.responseText : 'Please refresh this page and try again',
                        'error'
                    );

                }
            });

            $("#refNumber").val('');
            $("#change").text('');
            $("#payment").val('');

        }


        $.get(api + 'on-hold', (data) => {
            holdOrderList = data;
            holdOrderlocation.empty();
            clearInterval(dotInterval);
            $(this).randerHoldOrders(holdOrderList, holdOrderlocation, 1);
        });


        $.fn.getHoldOrders = function () {
            $.get(api + 'on-hold', (data) => {
                holdOrderList = data;
                clearInterval(dotInterval);
                holdOrderlocation.empty();
                $(this).randerHoldOrders(holdOrderList, holdOrderlocation, 1);
            });
        };


        $.fn.randerHoldOrders = function (data, renderLocation, orderType) {
            $.each(data, function (index, order) {
                $(this).calculatePrice(order);
                renderLocation.append(
                    $('<div>', { class: orderType == 1 ? 'col-md-3 order' : 'col-md-3 customer-order' }).append(
                        $('<a>').append(
                            $('<div>', { class: 'card-box order-box' }).append(
                                $('<p>').append(
                                    $('<b>', { text: 'Ref :' }),
                                    $('<span>', { text: order.ref_number, class: 'ref_number' }),
                                    $('<br>'),
                                    $('<b>', { text: 'Price :' }),
                                    $('<span>', { text: order.total, class: "label label-info", style: 'font-size:14px;' }),
                                    $('<br>'),
                                    $('<b>', { text: 'Items :' }),
                                    $('<span>', { text: order.items.length }),
                                    $('<br>'),
                                    $('<b>', { text: 'Customer :' }),
                                    $('<span>', { text: order.customer != 0 ? order.customer.name : 'Walk in customer', class: 'customer_name' })
                                ),
                                $('<button>', { class: 'btn btn-danger del', onclick: '$(this).deleteOrder(' + index + ',' + orderType + ')' }).append(
                                    $('<i>', { class: 'fa fa-trash' })
                                ),

                                $('<button>', { class: 'btn btn-default', onclick: '$(this).orderDetails(' + index + ',' + orderType + ')' }).append(
                                    $('<span>', { class: 'fa fa-shopping-basket' })
                                )
                            )
                        )
                    )
                )
            })
        }


        $.fn.calculatePrice = function (data) {
            totalPrice = 0;
            $.each(data.products, function (index, product) {
                totalPrice += product.price * product.quantity;
            })

            let vat = (totalPrice * data.vat) / 100;
            totalPrice = ((totalPrice + vat) - data.discount).toFixed(0);

            return totalPrice;
        };


        $.fn.orderDetails = function (index, orderType) {

            $('#refNumber').val('');

            if (orderType == 1) {

                $('#refNumber').val(holdOrderList[index].ref_number);

                $("#customer option:selected").removeAttr('selected');

                $("#customer option").filter(function () {
                    return $(this).text() == "Walk in customer";
                }).prop("selected", true);

                holdOrder = holdOrderList[index]._id;
                cart = [];
                $.each(holdOrderList[index].items, function (index, product) {
                    item = {
                        id: product.id,
                        product_name: product.product_name,
                        sku: product.sku,
                        price: product.price,
                        quantity: product.quantity,
                        category: product.category,
                        ml: product.ml || 0,
                        liquid_product_id: product.liquid_product_id || null
                    };
                    cart.push(item);
                })
            } else if (orderType == 2) {

                $('#refNumber').val('');

                $("#customer option:selected").removeAttr('selected');

                $("#customer option").filter(function () {
                    return $(this).text() == customerOrderList[index].customer.name;
                }).prop("selected", true);


                holdOrder = customerOrderList[index]._id;
                cart = [];
                $.each(customerOrderList[index].items, function (index, product) {
                    item = {
                        id: product.id,
                        product_name: product.product_name,
                        sku: product.sku,
                        price: product.price,
                        quantity: product.quantity,
                        category: product.category,
                        ml: product.ml || 0,
                        liquid_product_id: product.liquid_product_id || null
                    };
                    cart.push(item);
                })
            }
            $(this).renderTable(cart);
            $("#holdOrdersModal").modal('hide');
            $("#customerModal").modal('hide');
        }


        $.fn.deleteOrder = function (index, type) {

            switch (type) {
                case 1: deleteId = holdOrderList[index]._id;
                    break;
                case 2: deleteId = customerOrderList[index]._id;
            }

            let data = {
                orderId: deleteId,
            }

            Swal.fire({
                title: "Delete order?",
                text: "This will delete the order. Are you sure you want to delete!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, delete it!'
            }).then((result) => {

                if (result.value) {

                    $.ajax({
                        url: api + 'delete',
                        type: 'POST',
                        data: JSON.stringify(data),
                        contentType: 'application/json; charset=utf-8',
                        cache: false,
                        success: function (data) {

                            $(this).getHoldOrders();
                            $(this).getCustomerOrders();

                            Swal.fire(
                                'Deleted!',
                                'You have deleted the order!',
                                'success'
                            )

                        }, error: function (data) {
                            $(".loading").hide();

                        }
                    });
                }
            });
        }



        $.fn.getCustomerOrders = function () {
            $.get(api + 'customer-orders', (data) => {
                clearInterval(dotInterval);
                customerOrderList = data;
                customerOrderLocation.empty();
                $(this).randerHoldOrders(customerOrderList, customerOrderLocation, 2);
            });
        }



        $('#saveCustomer').on('submit', function (e) {

            e.preventDefault();

            let custData = {
                _id: Date.now(),
                name: $('#userName').val(),
                phone: $('#phoneNumber').val(),
                email: $('#emailAddress').val(),
                address: $('#userAddress').val()
            }

            $.ajax({
                url: api + 'customers/customer',
                type: 'POST',
                data: JSON.stringify(custData),
                contentType: 'application/json; charset=utf-8',
                cache: false,
                processData: false,
                success: function (data) {
                    $("#newCustomer").modal('hide');
                    Swal.fire("Customer added!", "Customer added successfully!", "success");
                    $("#customer option:selected").removeAttr('selected');
                    const custOptionValue = JSON.stringify({ id: custData._id, name: custData.name });
                    $('#customer').append(
                        $('<option>', { text: custData.name, value: custOptionValue, selected: 'selected' })
                    );

                    $('#customer').val(custOptionValue).trigger('chosen:updated');

                }, error: function (data) {
                    $("#newCustomer").modal('hide');
                    Swal.fire('Error', 'Something went wrong please try again', 'error')
                }
            })
        })


        $("#confirmPayment").hide();

        $("#cardInfo").hide();

        $("#payment").on('input', function () {
            $(this).calculateChange();
        });


        $(".list-group-item").on('click', function () {
            $(".list-group-item").removeClass('active');
            $(this).addClass('active');
            
            // Set paymentType based on the button clicked
            if (this.id == 'cash') {
                paymentType = 1;
                $("#cardInfo").hide();
            }
            if (this.id == 'cheque') {
                paymentType = 2;
                $("#cardInfo").show();
                $("#cardInfo .input-group-addon").text("Check Info");
            }
            if (this.id == 'card') {
                paymentType = 3;
                $("#cardInfo").show();
                $("#cardInfo .input-group-addon").text("Card Info");
            }
            if (this.id == 'on_account') {
                paymentType = 4;
                $("#cardInfo").hide();
            }
            
            $(this).calculateChange();
        });


        $.fn.calculateChange = function () {
            let change = (parseFloat($("#payment").val()) || 0) - orderTotal;
            if (change >= 0) {
                $("#change").text(change.toFixed(2));
                $("#confirmPayment").show();
            } else {
                $("#change").text(Math.abs(change).toFixed(2));
                if (paymentType == 4) {
                    $("#confirmPayment").show();
                } else {
                    $("#confirmPayment").hide();
                }
            }
        }


        $.fn.go = function (value, isDueInput) {
            if (isDueInput) {
                $("#refNumber").val($("#refNumber").val() + "" + value)
            } else {
                $("#payment").val($("#payment").val() + "" + value);
                $(this).calculateChange();
            }
        }


        $.fn.digits = function () {
            $("#payment").val($("#payment").val() + ".");
            $(this).calculateChange();
        }


        $("#confirmPayment").on('click', function () {
            if ($('#payment').val() == "" && paymentType != 4) {
                Swal.fire(
                    'Nope!',
                    'Please enter the amount that was paid!',
                    'warning'
                );
            }
            else {
                if(paymentType == 4 && $("#customer").val() == 0) {
                    Swal.fire(
                        'Customer Required!',
                        'You must select a customer for "On Account" payments.',
                        'warning'
                    );
                    return;
                }
                $(this).submitDueOrder(1);
            }
        });


        $('#transactions').click(function () {
            loadTransactions();
            loadUserList();

            $('#pos_view').hide();
            $('#pointofsale').show();
            $('#transactions_view').show();
            $(this).hide();

        });


        $('#pointofsale').click(function () {
            $('#pos_view').show();
            $('#transactions').show();
            $('#transactions_view').hide();
            $(this).hide();
        });


        $("#viewRefOrders").click(function () {
            setTimeout(function () {
                $("#holdOrderInput").focus();
            }, 500);
        });


        $("#viewCustomerOrders").click(function () {
            setTimeout(function () {
                $("#holdCustomerOrderInput").focus();
            }, 500);
        });


        $('#newProductModal').click(function () {
            loadCategories();
            loadAttributes();
            $('#saveProduct').get(0).reset();
            // Explicitly clear hidden fields — form.reset() does NOT clear these
            $('#product_id').val('');
            $('#remove_img').val('');
            $('#current_img').text('');
            $('#imagename').show();
            $('#rmv_img').hide();
            // Reset to blank category state (all attribute sections hidden)
            $('#hw-fields, #liq-fields, #brand-section, #refill-note, #price-per-ml-section').hide();
            $('#stock-section').show();
            $('#cat-type-badge').html('');
            $('#price_label').html('Sale Price <span class="text-danger">*</span>');
            $('#price_per_ml').val('');
            $('#ml_preview').text('—');
            $('#product-modal-title').text('Add Product');
            $('#product-modal-icon').attr('class', 'fa fa-plus-circle');
        });


        $('#saveProduct').submit(function (e) {
            e.preventDefault();

            $(this).attr('action', api + 'inventory/product');
            $(this).attr('method', 'POST');

            $(this).ajaxSubmit({
                contentType: 'application/json',
                success: function (response) {

                    $('#saveProduct').get(0).reset();
                    $('#current_img').text('');

                    loadProducts();
                    Swal.fire({
                        title: 'Product Saved',
                        text: "Select an option below to continue.",
                        icon: 'success',
                        showCancelButton: true,
                        confirmButtonColor: '#3085d6',
                        cancelButtonColor: '#d33',
                        confirmButtonText: 'Add another',
                        cancelButtonText: 'Close'
                    }).then((result) => {

                        if (!result.value) {
                            $("#newProduct").modal('hide');
                        }
                    });
                }, error: function (data) {
                    console.error('Product save failed:', data);
                    Swal.fire('Save Failed', (data.responseText || 'Could not save product. Please try again.'), 'error');
                }
            });

        });



        $('#saveCategory').submit(function (e) {
            e.preventDefault();

            if ($('#category_id').val() == "") {
                method = 'POST';
            }
            else {
                method = 'PUT';
            }

            $.ajax({
                type: method,
                url: api + 'categories/category',
                data: $(this).serialize(),
                success: function (data, textStatus, jqXHR) {
                    $('#saveCategory').get(0).reset();
                    loadCategories();
                    loadProducts();
                    Swal.fire({
                        title: 'Category Saved',
                        text: "Select an option below to continue.",
                        icon: 'success',
                        showCancelButton: true,
                        confirmButtonColor: '#3085d6',
                        cancelButtonColor: '#d33',
                        confirmButtonText: 'Add another',
                        cancelButtonText: 'Close'
                    }).then((result) => {

                        if (!result.value) {
                            $("#newCategory").modal('hide');
                        }
                    });
                }, error: function (data) {
                    console.log(data);
                }

            });


        });


        $.fn.editProduct = function (index) {

            $('#Products').modal('hide');

            const p = allProducts[index];

            // Reset form first
            $('#saveProduct').get(0).reset();
            $('#current_img').text('');
            $('#imagename').show();
            $('#rmv_img').hide();

            // Set category and trigger UI update
            $("#category option").filter(function () {
                return $(this).val() == p.category;
            }).prop("selected", true);
            applyProductCategoryUI(p.category);

            // Populate fields
            $('#product_id').val(p._id);
            $('#img').val(p.img);
            $('#productName').val(p.name);
            $('#product_price').val(p.price);
            $('#quantity').val(p.quantity);
            $('#purchase_price').val(p.purchase_price || 0);
            $('#min_stock').val(p.min_stock || 0);
            $('#brand').val(p.brand || '');
            $('#model').val(p.model || '');
            $('#flavor').val(p.flavor || '');
            $('#size').val(p.size || '');
            $('#nicotine').val(p.nicotine || '');
            $('#product_barcode').val(p.barcode || '');
            $('#price_per_ml').val(p.price_per_ml || '');
            const previewRate = parseFloat(p.price_per_ml);
            $('#ml_preview').text(previewRate > 0 ? Math.round(200 / previewRate) + ' ml' : '—');

            if (p.stock == 0) {
                $('#stock').prop('checked', true);
            }

            if (p.img) {
                $('#imagename').hide();
                $('#current_img').html(`<img src="${img_path + p.img}" alt="" style="max-height:60px;">`);
                $('#rmv_img').show();
            }

            $('#product-modal-title').text('Edit Product');
            $('#product-modal-icon').attr('class', 'fa fa-edit');
            $('#newProduct').modal('show');
        }


        $("#userModal").on("hide.bs.modal", function () {
            $('.perms').hide();
        });


        $.fn.editUser = function (index) {

            user_index = index;

            $('#Users').modal('hide');

            $('.perms').show();

            $("#user_id").val(allUsers[index]._id);
            $('#fullname').val(allUsers[index].fullname);
            $('#username').val(allUsers[index].username);
            $('#password').val(atob(allUsers[index].password));

            if (allUsers[index].perm_products == 1) {
                $('#perm_products').prop("checked", true);
            }
            else {
                $('#perm_products').prop("checked", false);
            }

            if (allUsers[index].perm_categories == 1) {
                $('#perm_categories').prop("checked", true);
            }
            else {
                $('#perm_categories').prop("checked", false);
            }

            if (allUsers[index].perm_transactions == 1) {
                $('#perm_transactions').prop("checked", true);
            }
            else {
                $('#perm_transactions').prop("checked", false);
            }

            if (allUsers[index].perm_users == 1) {
                $('#perm_users').prop("checked", true);
            }
            else {
                $('#perm_users').prop("checked", false);
            }

            if (allUsers[index].perm_settings == 1) {
                $('#perm_settings').prop("checked", true);
            }
            else {
                $('#perm_settings').prop("checked", false);
            }

            $('#userModal').modal('show');
        }


        $.fn.editCategory = function (index) {
            const cat = allCategories[index];
            $('#Categories').modal('hide');
            $('#categoryName').val(cat.name);
            $('#category_id').val(cat._id);
            // Restore parent selection so editing a subcategory doesn't wipe its parentId
            $('#parentCategory').val(cat.parentId || '');
            $('#newCategory').modal('show');
        }


        $.fn.adjustStock = function (productId, productName, currentQty) {
            Swal.fire({
                title: 'Adjust Stock: ' + productName,
                html: `Current quantity: <b>${currentQty}</b><br>Enter a positive number to add stock, negative to remove.`,
                input: 'number',
                inputPlaceholder: 'e.g. 10 or -2',
                showCancelButton: true,
                confirmButtonText: 'Apply Adjustment',
                inputValidator: (value) => {
                    if (!value || isNaN(parseInt(value)) || parseInt(value) === 0) {
                        return 'Please enter a non-zero integer adjustment';
                    }
                    if (currentQty + parseInt(value) < 0) {
                        return 'Adjustment would result in negative stock (' + (currentQty + parseInt(value)) + ')';
                    }
                }
            }).then((result) => {
                if (result.value) {
                    Swal.fire({
                        title: 'Reason for adjustment?',
                        input: 'text',
                        inputPlaceholder: 'e.g. stock count, damage, return',
                        showCancelButton: true,
                        confirmButtonText: 'Save'
                    }).then((reasonResult) => {
                        $.ajax({
                            url: api + 'inventory/adjust',
                            type: 'POST',
                            data: JSON.stringify({
                                productId,
                                adjustment: parseInt(result.value),
                                reason: reasonResult.value || '',
                                user_id: user._id
                            }),
                            contentType: 'application/json',
                            success: function(data) {
                                loadProducts();
                                loadProductList();
                                Swal.fire('Done', 'Stock adjusted. New quantity: ' + data.newQuantity, 'success');
                            },
                            error: function(xhr) {
                                Swal.fire('Error', xhr.responseText || 'Adjustment failed.', 'error');
                            }
                        });
                    });
                }
            });
        };

        $.fn.deleteProduct = function (id) {
            Swal.fire({
                title: 'Are you sure?',
                text: "You are about to delete this product.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, delete it!'
            }).then((result) => {

                if (result.value) {

                    $.ajax({
                        url: api + 'inventory/product/' + id,
                        type: 'DELETE',
                        success: function (result) {
                            loadProducts();
                            Swal.fire(
                                'Done!',
                                'Product deleted',
                                'success'
                            );

                        }
                    });
                }
            });
        }


        $.fn.deleteUser = function (id) {
            Swal.fire({
                title: 'Are you sure?',
                text: "You are about to delete this user.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, delete!'
            }).then((result) => {

                if (result.value) {

                    $.ajax({
                        url: api + 'users/user/' + id,
                        type: 'DELETE',
                        success: function (result) {
                            loadUserList();
                            Swal.fire(
                                'Done!',
                                'User deleted',
                                'success'
                            );

                        }
                    });
                }
            });
        }


        $.fn.deleteCategory = function (id) {
            Swal.fire({
                title: 'Are you sure?',
                text: "You are about to delete this category.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, delete it!'
            }).then((result) => {

                if (result.value) {

                    $.ajax({
                        url: api + 'categories/category/' + id,
                        type: 'DELETE',
                        success: function (result) {
                            loadCategories();
                            Swal.fire(
                                'Done!',
                                'Category deleted',
                                'success'
                            );

                        }
                    });
                }
            });
        }


        $('#productModal').click(function () {
            loadProductList();
        });


        $('#usersModal').click(function () {
            loadUserList();
        });


        $('#categoryModal').click(function () {
            loadCategories();
        });

        // Reset category form when the modal is opened via "Add New" button (not via editCategory)
        $('#newCategory').on('show.bs.modal', function () {
            if ($('#category_id').val() === '') {
                $('#saveCategory').get(0).reset();
                $('#parentCategory').val('');
            }
        });
        // Clear edit id when modal is dismissed so next open is treated as "Add New"
        $('#newCategory').on('hidden.bs.modal', function () {
            $('#category_id').val('');
            $('#saveCategory').get(0).reset();
        });


        // ── Stock Receiving ──────────────────────────────────────────────

        function loadSuppliersForReceiving() {
            $.get(api + 'suppliers/all', function(suppliers) {
                let opts = '<option value="">-- No Supplier / Manual --</option>';
                suppliers.forEach(s => {
                    opts += `<option value="${s._id}">${s.name}${s.balance > 0 ? ' (owes: ' + settings.symbol + parseFloat(s.balance).toFixed(2) + ')' : ''}</option>`;
                });
                $('#sr_supplier').html(opts);
            });
        }

        function loadProductsForReceiving() {
            let opts = '<option value="">-- Select Product --</option>';
            allProducts.forEach(p => {
                opts += `<option value="${p._id}">${p.name} (Stock: ${p.stock == 1 ? p.quantity : 'N/A'})</option>`;
            });
            $('.sr_product').html(opts);
        }

        $('#stockReceivingBtn').click(function() {
            loadSuppliersForReceiving();
            loadProductsForReceiving();
            let rowCount = 1;
            $('#sr_items_body').html(`<tr id="sr_item_row_0">
                <td><select class="form-control sr_product" id="sr_product_0"></select></td>
                <td><input type="number" class="form-control sr_qty" id="sr_qty_0" min="1" value="1"></td>
                <td><input type="number" class="form-control sr_cost" id="sr_cost_0" step="0.01" min="0" placeholder="Per Unit"></td>
                <td></td>
            </tr>`);
            loadProductsForReceiving();
        });

        $.fn.addStockReceivingRow = function() {
            let nextId = $('.sr_product').length;
            let opts = '<option value="">-- Select Product --</option>';
            allProducts.forEach(p => { opts += `<option value="${p._id}">${p.name}</option>`; });
            let row = `<tr id="sr_item_row_${nextId}">
                <td><select class="form-control sr_product" id="sr_product_${nextId}">${opts}</select></td>
                <td><input type="number" class="form-control sr_qty" id="sr_qty_${nextId}" min="1" value="1"></td>
                <td><input type="number" class="form-control sr_cost" id="sr_cost_${nextId}" step="0.01" min="0" placeholder="Per Unit"></td>
                <td><button type="button" class="btn btn-danger btn-xs" onclick="$(this).closest('tr').remove()"><i class="fa fa-times"></i></button></td>
            </tr>`;
            $('#sr_items_body').append(row);
        };

        $.fn.submitStockReceiving = function() {
            const supplierId = $('#sr_supplier').val();
            const supplierName = $('#sr_supplier option:selected').text();
            const notes = $('#sr_notes').val();

            const items = [];
            let valid = true;

            $('#sr_items_body tr').each(function() {
                const productId = $(this).find('.sr_product').val();
                const qty = parseInt($(this).find('.sr_qty').val());
                const cost = parseFloat($(this).find('.sr_cost').val()) || 0;
                if (productId && qty > 0) {
                    items.push({ productId, quantity: qty, cost_price: cost });
                } else if (productId && qty <= 0) {
                    valid = false;
                }
            });

            if (!valid) { Swal.fire('Error', 'All items must have quantity > 0', 'error'); return; }
            if (items.length === 0) { Swal.fire('Error', 'Please select at least one product', 'error'); return; }

            $.ajax({
                url: api + 'purchases/receive',
                type: 'POST',
                data: JSON.stringify({
                    supplierId: supplierId || null,
                    supplierName: supplierId ? supplierName : 'Manual',
                    items,
                    notes,
                    received_by: user.fullname,
                    received_by_id: user._id
                }),
                contentType: 'application/json',
                success: function() {
                    $('#stockReceivingModal').modal('hide');
                    loadProducts();
                    Swal.fire('Stock Received', items.length + ' product(s) updated successfully.', 'success');
                },
                error: function(xhr) {
                    Swal.fire('Error', xhr.responseText || 'Failed to receive stock.', 'error');
                }
            });
        };


        // ── Supplier Management ──────────────────────────────────────────

        function loadSuppliers() {
            $.get(api + 'suppliers/all', function(suppliers) {
                let rows = '';
                suppliers.forEach(s => {
                    const balance = parseFloat(s.balance) || 0;
                    const balanceCell = balance > 0
                        ? `<span class="text-danger"><b>${settings.symbol}${balance.toFixed(2)}</b></span>`
                        : `<span class="text-muted">${settings.symbol}0.00</span>`;
                    rows += `<tr>
                        <td><b>${s.name}</b></td>
                        <td>${s.phone || '—'}</td>
                        <td>${s.email || '—'}</td>
                        <td>${balanceCell}</td>
                        <td>
                            <div class="btn-group btn-group-sm">
                                ${balance > 0 ? `<button class="btn btn-success" onclick="$(this).paySupplier('${s._id}','${s.name.replace(/'/g,'')}',${balance})"><i class="fa fa-money"></i> Pay</button>` : ''}
                                <button class="btn btn-info" onclick="$(this).viewSupplierHistory('${s._id}','${s.name.replace(/'/g,'')}')"><i class="fa fa-history"></i> History</button>
                                <button class="btn btn-warning" onclick="$(this).editSupplier('${s._id}','${s.name.replace(/'/g,'')}','${s.phone||''}','${s.email||''}')"><i class="fa fa-edit"></i></button>
                            </div>
                        </td>
                    </tr>`;
                });
                if (rows) {
                    $('#supplier_list').html(rows);
                    $('#supplier_empty').hide();
                } else {
                    $('#supplier_list').html('');
                    $('#supplier_empty').show();
                }
            });
        }

        $('#suppliersBtn').click(function() {
            loadSuppliers();
            $('#supplier-form-panel').hide();
            $('#supplier_edit_id').val('');
        });

        $.fn.showSupplierForm = function() {
            $('#supplier_edit_id').val('');
            $('#supplier_name').val('');
            $('#supplier_phone').val('');
            $('#supplier_email').val('');
            $('#supplier-form-title').text('New Supplier');
            $('#supplier-form-panel').slideDown();
            $('#supplier_name').focus();
        };

        $.fn.editSupplier = function(id, name, phone, email) {
            $('#supplier_edit_id').val(id);
            $('#supplier_name').val(name);
            $('#supplier_phone').val(phone);
            $('#supplier_email').val(email);
            $('#supplier-form-title').text('Edit Supplier');
            $('#supplier-form-panel').slideDown();
            $('#supplier_name').focus();
        };

        $.fn.saveSupplier = function() {
            const id = $('#supplier_edit_id').val();
            const name = $('#supplier_name').val().trim();
            const phone = $('#supplier_phone').val().trim();
            const email = $('#supplier_email').val().trim();

            if (!name) { Swal.fire('Required', 'Supplier name is required.', 'warning'); return; }

            const payload = { name, phone, email };
            if (id) payload._id = id;

            $.ajax({
                url: api + 'suppliers/supplier',
                type: 'POST',
                data: JSON.stringify(payload),
                contentType: 'application/json',
                success: function() {
                    $('#supplier-form-panel').slideUp();
                    loadSuppliers();
                    loadSuppliersForReceiving();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success',
                        title: id ? 'Supplier updated' : 'Supplier added', timer: 2000, showConfirmButton: false });
                },
                error: function(xhr) {
                    Swal.fire('Error', xhr.responseText || 'Could not save supplier.', 'error');
                }
            });
        };

        $.fn.paySupplier = function(id, name, balance) {
            // Hide the Bootstrap modal first to release its focus trap, then show Swal
            $('#suppliersModal').modal('hide');
            setTimeout(function() {
            Swal.fire({
                title: 'Pay Supplier: ' + name,
                html: 'Outstanding: <b>' + settings.symbol + parseFloat(balance).toFixed(2) + '</b>',
                input: 'number',
                inputPlaceholder: 'Amount to pay',
                showCancelButton: true,
                confirmButtonText: 'Confirm Payment',
                onOpen: () => { setTimeout(() => { const inp = Swal.getInput(); if (inp) { inp.focus(); inp.select(); } }, 100); },
                inputValidator: (v) => {
                    const a = parseFloat(v);
                    if (!v || isNaN(a) || a <= 0) return 'Enter a valid amount greater than 0';
                    if (a > balance) return 'Cannot exceed outstanding balance of ' + settings.symbol + parseFloat(balance).toFixed(2);
                }
            }).then(result => {
                if (!result.value) {
                    // User cancelled — reopen suppliers modal
                    $('#suppliersModal').modal('show');
                    return;
                }
                $.ajax({
                    url: api + 'suppliers/pay',
                    type: 'POST',
                    data: JSON.stringify({ supplierId: id, amount: parseFloat(result.value) }),
                    contentType: 'application/json',
                    success: function() {
                        loadSuppliers();
                        Swal.fire('Done', 'Payment of ' + settings.symbol + parseFloat(result.value).toFixed(2) + ' recorded.', 'success')
                            .then(() => { $('#suppliersModal').modal('show'); });
                    },
                    error: function(xhr) {
                        Swal.fire('Error', xhr.responseText || 'Payment failed.', 'error')
                            .then(() => { $('#suppliersModal').modal('show'); });
                    }
                });
            });
            }, 400); // wait for Bootstrap modal to fully release focus
        };

        $.fn.viewSupplierHistory = function(id, name) {
            $('#suppliersModal').modal('hide');
            $('#supplier_history_title').text(name + ' — Purchase History');
            $('#supplier_history_list').html('<tr><td colspan="5" class="text-center"><i class="fa fa-spinner fa-spin"></i> Loading...</td></tr>');
            $('#supplier_history_empty').hide();
            $('#supplierHistoryModal').modal('show');

            $.get(api + 'purchases/all', function(purchases) {
                const filtered = purchases.filter(p => p.supplierId === id);
                if (filtered.length === 0) {
                    $('#supplier_history_list').html('');
                    $('#supplier_history_empty').show();
                    return;
                }
                let rows = '';
                filtered.forEach(p => {
                    const itemSummary = (p.items || []).map(i => {
                        const prod = allProducts.find(pr => String(pr._id) === String(i.productId));
                        return `${prod ? prod.name : 'Product #'+i.productId} ×${i.quantity}${i.cost_price ? ' @ Rs.'+i.cost_price : ''}`;
                    }).join('<br>');
                    rows += `<tr>
                        <td class="nobr">${moment(p.created_at).format('YYYY-MM-DD HH:mm')}</td>
                        <td style="font-size:12px;">${itemSummary || '—'}</td>
                        <td><b>${settings.symbol}${parseFloat(p.total).toFixed(2)}</b></td>
                        <td>${p.notes || '—'}</td>
                        <td>${p.received_by || '—'}</td>
                    </tr>`;
                });
                $('#supplier_history_list').html(rows);
            });
        };

        // Quick-add supplier from within the Stock Receiving modal
        $.fn.openQuickAddSupplier = function() {
            $('#quick-supplier-form').slideToggle();
            $('#qs_name').focus();
        };

        $.fn.saveQuickSupplier = function() {
            const name = $('#qs_name').val().trim();
            if (!name) { Swal.fire('Required', 'Supplier name is required.', 'warning'); return; }

            $.ajax({
                url: api + 'suppliers/supplier',
                type: 'POST',
                data: JSON.stringify({ name, phone: $('#qs_phone').val().trim(), email: $('#qs_email').val().trim() }),
                contentType: 'application/json',
                success: function(newSupplier) {
                    $('#quick-supplier-form').slideUp();
                    $('#qs_name, #qs_phone, #qs_email').val('');
                    loadSuppliersForReceiving();
                    // Select the newly created supplier after reload
                    setTimeout(() => { $('#sr_supplier').val(newSupplier._id || '').trigger('change'); }, 300);
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Supplier added', timer: 2000, showConfirmButton: false });
                },
                error: function(xhr) {
                    Swal.fire('Error', xhr.responseText || 'Could not save supplier.', 'error');
                }
            });
        };

        // ── Z-Report ─────────────────────────────────────────────────────

        $('#zReportBtn').click(function() {
            const today = new Date().toISOString().split('T')[0];
            $('#zreport_date').val(today);
        });

        $.fn.loadZReport = function() {
            const date = $('#zreport_date').val();
            if (!date) { Swal.fire('Error', 'Please select a date.', 'error'); return; }
            $('#zreport_content').html('<p class="text-muted"><i class="fa fa-spinner fa-spin"></i> Loading...</p>');
            $.get(api + 'reports/daily?date=' + date, function(report) {
                const sym = settings && settings.symbol ? settings.symbol : '';
                let topSellerRows = '';
                report.topSellers.forEach((p, i) => {
                    topSellerRows += `<tr><td>${i+1}</td><td>${p.name}</td><td>${p.qty}</td><td>${sym}${parseFloat(p.revenue).toFixed(2)}</td></tr>`;
                });

                // Category sales breakdown — resolve category names from allCategories
                let catRows = '';
                if (report.categorySales && report.categorySales.length > 0) {
                    report.categorySales.forEach(cs => {
                        const catObj = allCategories.find(c => String(c._id) === String(cs.category));
                        const catName = catObj ? catObj.name : ('Category #' + cs.category);
                        catRows += `<tr><td>${catName}</td><td>${cs.qty}</td><td>${sym}${parseFloat(cs.total).toFixed(2)}</td></tr>`;
                    });
                }

                $('#zreport_content').html(`
                    <h4 style="margin-top:0;">Report for <b>${date}</b></h4>
                    <div class="row">
                        <div class="col-md-3">
                            <div class="panel panel-success"><div class="panel-heading">Total Sales</div><div class="panel-body"><h3>${sym}${parseFloat(report.totalSales).toFixed(2)}</h3></div></div>
                        </div>
                        <div class="col-md-3">
                            <div class="panel panel-info"><div class="panel-heading">Transactions</div><div class="panel-body"><h3>${report.totalTransactions}</h3></div></div>
                        </div>
                        <div class="col-md-3">
                            <div class="panel panel-warning"><div class="panel-heading">Refill Revenue</div><div class="panel-body"><h3>${sym}${parseFloat(report.refillTotal).toFixed(2)}</h3></div></div>
                        </div>
                        <div class="col-md-3">
                            <div class="panel panel-default"><div class="panel-heading">Est. Gross Profit</div><div class="panel-body"><h3>${sym}${parseFloat(report.profitEstimate).toFixed(2)}</h3></div></div>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-3">
                            <div class="panel panel-danger"><div class="panel-heading"><i class="fa fa-minus-circle"></i> Total Expenses</div><div class="panel-body"><h3>${sym}${parseFloat(report.totalExpenses || 0).toFixed(2)}</h3></div></div>
                        </div>
                        <div class="col-md-3">
                            <div class="panel ${parseFloat(report.netProfit || 0) >= 0 ? 'panel-success' : 'panel-danger'}" style="border-width:2px;">
                                <div class="panel-heading"><strong><i class="fa fa-line-chart"></i> Net Profit</strong></div>
                                <div class="panel-body"><h2>${sym}${parseFloat(report.netProfit || 0).toFixed(2)}</h2></div>
                            </div>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-3">
                            <div class="panel panel-info">
                                <div class="panel-heading"><i class="fa fa-tint"></i> ML Dispensed Today</div>
                                <div class="panel-body"><h3>${report.totalMlDispensed || 0} ml</h3></div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="panel ${report.currentMlStock !== null && report.currentMlStock !== undefined && report.currentMlStock < 200 ? 'panel-danger' : 'panel-success'}">
                                <div class="panel-heading"><i class="fa fa-flask"></i> Liquid In Stock</div>
                                <div class="panel-body">
                                    ${report.currentMlStock !== null && report.currentMlStock !== undefined
                                        ? `<h3>${report.currentMlStock} ml</h3>`
                                        : `<small class="text-muted">Configure Refill Liquid product in Settings to track stock.</small>`}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-4">
                            <table class="table table-bordered table-condensed">
                                <tr><th>Payment Split</th><th></th></tr>
                                <tr><td>Cash</td><td>${sym}${parseFloat(report.cashTotal).toFixed(2)}</td></tr>
                                <tr><td>Card</td><td>${sym}${parseFloat(report.cardTotal).toFixed(2)}</td></tr>
                                <tr><td>On Account (Credit)</td><td>${sym}${parseFloat(report.onAccountTotal).toFixed(2)}</td></tr>
                            </table>
                            <table class="table table-bordered table-condensed">
                                <thead><tr><th>Category</th><th>Qty</th><th>Sales</th></tr></thead>
                                <tbody>${catRows || '<tr><td colspan="3" class="text-muted">No category data.</td></tr>'}</tbody>
                            </table>
                        </div>
                        <div class="col-md-8">
                            <table class="table table-bordered table-condensed">
                                <thead><tr><th>#</th><th>Top Seller</th><th>Qty</th><th>Revenue</th></tr></thead>
                                <tbody>${topSellerRows || '<tr><td colspan="4">No sales.</td></tr>'}</tbody>
                            </table>
                        </div>
                    </div>
                `);
            }).fail(function(xhr) {
                $('#zreport_content').html('<p class="text-danger">Failed to load report: ' + (xhr.responseText || 'unknown error') + '</p>');
            });
        };





        // ── Expense Tracking ─────────────────────────────────────────────

        $('#expensesBtn').click(function() {
            // Pre-fill today's date in the form
            const today = new Date().toISOString().split('T')[0];
            $('#exp_date').val(today);
            $('#exp_filter_start').val(today);
            $('#exp_filter_end').val(today);
            $(this).loadExpenses();
        });

        $.fn.loadExpenses = function(showAll) {
            let url;
            if (showAll) {
                url = api + 'expenses/all';
            } else {
                const start = $('#exp_filter_start').val();
                const end = $('#exp_filter_end').val();
                if (!start || !end) {
                    url = api + 'expenses/all';
                } else {
                    url = api + 'expenses/range?start=' + start + '&end=' + end;
                }
            }

            $('#expenses_list').html('<tr><td colspan="5" class="text-center"><i class="fa fa-spinner fa-spin"></i> Loading...</td></tr>');

            $.get(url, function(expenses) {
                const sym = settings && settings.symbol ? settings.symbol : 'Rs.';
                if (!expenses || expenses.length === 0) {
                    $('#expenses_list').html('<tr><td colspan="5" class="text-center text-muted">No expenses found.</td></tr>');
                    $('#exp_total_display').text(sym + ' 0.00');
                    return;
                }

                let rows = '';
                let total = 0;
                expenses.forEach(function(exp) {
                    total += parseFloat(exp.amount) || 0;
                    rows += `<tr>
                        <td>${moment(exp.date).format('YYYY-MM-DD')}</td>
                        <td><span class="label label-warning">${exp.category}</span></td>
                        <td><strong>${sym}${parseFloat(exp.amount).toFixed(2)}</strong></td>
                        <td>${exp.notes || '<span class="text-muted">—</span>'}</td>
                        <td>
                            <button class="btn btn-danger btn-xs" onclick="$(this).deleteExpense('${exp._id}')">
                                <i class="fa fa-trash"></i>
                            </button>
                        </td>
                    </tr>`;
                });

                $('#expenses_list').html(rows);
                total = Math.round(total * 100) / 100;
                $('#exp_total_display').text(sym + ' ' + total.toFixed(2));
            }).fail(function() {
                $('#expenses_list').html('<tr><td colspan="5" class="text-danger">Failed to load expenses.</td></tr>');
            });
        };

        $.fn.saveExpense = function() {
            const category = $('#exp_category').val();
            const amount = parseFloat($('#exp_amount').val());
            const notes = $('#exp_notes').val();
            const date = $('#exp_date').val();

            if (!category) { Swal.fire('Required', 'Please select a category.', 'warning'); return; }
            if (!amount || isNaN(amount) || amount <= 0) { Swal.fire('Required', 'Please enter a valid amount greater than 0.', 'warning'); return; }

            $.ajax({
                url: api + 'expenses/',
                type: 'POST',
                data: JSON.stringify({ category, amount, notes, date }),
                contentType: 'application/json',
                success: function() {
                    $('#exp_category').val('');
                    $('#exp_amount').val('');
                    $('#exp_notes').val('');
                    $(document).find('[data-dismiss="modal"]').first();
                    $('[data-target="#expensesModal"]').first().trigger('loadExpenses');
                    $('[data-dismiss]').first();
                    // Reload table
                    $('body').find('#expensesBtn').trigger('click.loadExpenses');
                    $(document).find('#expensesBtn').data('loaded', false);
                    // Simply reload the list
                    $.fn.loadExpenses.call($('body'), false);
                    Swal.fire({
                        toast: true, position: 'top-end', icon: 'success',
                        title: 'Expense saved!', timer: 2000, showConfirmButton: false
                    });
                },
                error: function(xhr) {
                    Swal.fire('Error', xhr.responseText || 'Could not save expense.', 'error');
                }
            });
        };

        $.fn.deleteExpense = function(id) {
            Swal.fire({
                title: 'Delete Expense?',
                text: 'This will permanently remove this expense record.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Delete'
            }).then(function(result) {
                if (!result.value) return;
                $.ajax({
                    url: api + 'expenses/' + id,
                    type: 'DELETE',
                    success: function() {
                        $.fn.loadExpenses.call($('body'), false);
                        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Deleted', timer: 1500, showConfirmButton: false });
                    },
                    error: function(xhr) {
                        Swal.fire('Error', xhr.responseText || 'Could not delete expense.', 'error');
                    }
                });
            });
        };


        $('#log-out').click(function () {

            Swal.fire({
                title: 'Are you sure?',
                text: "You are about to log out.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Logout'
            }).then((result) => {

                if (result.value) {
                    $.get(api + 'users/logout/' + user._id, function (data) {
                        storage.delete('auth');
                        storage.delete('user');
                        ipcRenderer.send('app-reload', '');
                    });
                }
            });
        });



        $('#settings_form').on('submit', function (e) {
            e.preventDefault();
            let formData = $(this).serializeObject();
            let mac_address;

            api = 'http://' + host + ':' + port + '/api/';

            macaddress.one(function (err, mac) {
                mac_address = mac;
            });

            formData['app'] = $('#app').find('option:selected').text();
            formData['mac'] = mac_address;
            formData['till'] = 1;

            $('#settings_form').append('<input type="hidden" name="app" value="' + formData.app + '" />');

            if (formData.percentage != "" && !$.isNumeric(formData.percentage)) {
                Swal.fire(
                    'Oops!',
                    'Please make sure the tax value is a number',
                    'warning'
                );
            }
            else {
                storage.set('settings', formData);

                $(this).attr('action', api + 'settings/post');
                $(this).attr('method', 'POST');


                $(this).ajaxSubmit({
                    contentType: 'application/json',
                    success: function (response) {

                        ipcRenderer.send('app-reload', '');

                    }, error: function (data) {
                        console.log(data);
                    }

                });

            }

        });



        $('#net_settings_form').on('submit', function (e) {
            e.preventDefault();
            let formData = $(this).serializeObject();

            if (formData.till == 0 || formData.till == 1) {
                Swal.fire(
                    'Oops!',
                    'Please enter a number greater than 1.',
                    'warning'
                );
            }
            else {
                if (isNumeric(formData.till)) {
                    formData['app'] = $('#app').find('option:selected').text();
                    storage.set('settings', formData);
                    ipcRenderer.send('app-reload', '');
                }
                else {
                    Swal.fire(
                        'Oops!',
                        'Till number must be a number!',
                        'warning'
                    );
                }

            }

        });



        $('#saveUser').on('submit', function (e) {
            e.preventDefault();
            let formData = $(this).serializeObject();

            console.log(formData);

            if (ownUserEdit) {
                if (formData.password != atob(user.password)) {
                    if (formData.password != formData.pass) {
                        Swal.fire(
                            'Oops!',
                            'Passwords do not match!',
                            'warning'
                        );
                    }
                }
            }
            else {
                if (formData.password != atob(allUsers[user_index].password)) {
                    if (formData.password != formData.pass) {
                        Swal.fire(
                            'Oops!',
                            'Passwords do not match!',
                            'warning'
                        );
                    }
                }
            }



            if (formData.password == atob(user.password) || formData.password == atob(allUsers[user_index].password) || formData.password == formData.pass) {
                $.ajax({
                    url: api + 'users/post',
                    type: 'POST',
                    data: JSON.stringify(formData),
                    contentType: 'application/json; charset=utf-8',
                    cache: false,
                    processData: false,
                    success: function (data) {

                        if (ownUserEdit) {
                            ipcRenderer.send('app-reload', '');
                        }

                        else {
                            $('#userModal').modal('hide');

                            loadUserList();

                            $('#Users').modal('show');
                            Swal.fire(
                                'Ok!',
                                'User details saved!',
                                'success'
                            );
                        }


                    }, error: function (data) {
                        console.log(data);
                    }

                });

            }

        });



        $('#app').change(function () {
            if ($(this).find('option:selected').text() == 'Network Point of Sale Terminal') {
                $('#net_settings_form').show(500);
                $('#settings_form').hide(500);
                macaddress.one(function (err, mac) {
                    $("#mac").val(mac);
                });
            }
            else {
                $('#net_settings_form').hide(500);
                $('#settings_form').show(500);
            }

        });



        $('#cashier').click(function () {

            ownUserEdit = true;

            $('#userModal').modal('show');

            $("#user_id").val(user._id);
            $("#fullname").val(user.fullname);
            $("#username").val(user.username);
            $("#password").val(atob(user.password));

        });



        $('#add-user').click(function () {

            if (platform && platform.app != 'Network Point of Sale Terminal') {
                $('.perms').show();
            }

            $("#saveUser").get(0).reset();
            $('#userModal').modal('show');

        });



        $('#settings').click(function () {

            if (platform && platform.app == 'Network Point of Sale Terminal') {
                $('#net_settings_form').show(500);
                $('#settings_form').hide(500);

                $("#ip").val(platform.ip);
                $("#till").val(platform.till);

                macaddress.one(function (err, mac) {
                    $("#mac").val(mac);
                });

                $("#app option").filter(function () {
                    return $(this).text() == platform.app;
                }).prop("selected", true);
            }
            else {
                $('#net_settings_form').hide(500);
                $('#settings_form').show(500);

                $("#settings_id").val("1");
                $("#store").val(settings.store);
                $("#address_one").val(settings.address_one);
                $("#address_two").val(settings.address_two);
                $("#contact").val(settings.contact);
                $("#tax").val(settings.tax);
                $("#symbol").val(settings.symbol);
                $("#percentage").val(settings.percentage);
                $("#footer").val(settings.footer);
                $("#logo_img").val(settings.img);
                if (settings.charge_tax == 'on') {
                    $('#charge_tax').prop("checked", true);
                }
                if (settings.img != "") {
                    $('#logoname').hide();
                    $('#current_logo').html(`<img src="${img_path + settings.img}" alt="">`);
                    $('#rmv_logo').show();
                }

                $("#app option").filter(function () {
                    return $(this).text() == settings.app;
                }).prop("selected", true);

                // Populate ML config — load refill products for the dropdown
                $.get(api + 'settings/ml-config', function(cfg) {
                    const savedId = cfg ? (cfg.liquid_product_id || '') : '';

                    function showMlPreview(rate) {
                        if (rate > 0) {
                            $('#ml_rate_display').text(rate.toFixed(2));
                            $('#ml_200_preview').text(Math.round(200 / rate));
                            $('#ml_400_preview').text(Math.round(400 / rate));
                            $('#ml_600_preview').text(Math.round(600 / rate));
                            $('#ml_rate_preview').show();
                        } else {
                            $('#ml_rate_preview').hide();
                        }
                    }

                    $.get(api + 'inventory/products', function(products) {
                        const refillCat = allCategories.find(c => c.name.toLowerCase() === 'refill');
                        const refillId = refillCat ? refillCat._id : null;
                        const tracked = products.filter(p =>
                            String(p.category) === String(refillId) && parseInt(p.stock) === 1
                        );
                        const $sel = $('#ml_liquid_product_id');
                        $sel.find('option:not(:first)').remove();
                        if (tracked.length === 0) {
                            $sel.append('<option disabled>No Refill products with stock tracking found — add one in Products</option>');
                        } else {
                            tracked.forEach(p => {
                                const rate = parseFloat(p.price_per_ml) || 0;
                                const rateLabel = rate > 0 ? ` · ${rate} Rs./ml` : ' · no rate set';
                                $sel.append(`<option value="${p._id}" data-rate="${rate}">${p.name} — ${parseInt(p.quantity)||0} ml in stock${rateLabel}</option>`);
                            });
                        }
                        if (savedId) $sel.val(String(savedId));
                        // Show preview for currently saved product
                        const $selected = $sel.find('option:selected');
                        showMlPreview(parseFloat($selected.data('rate')) || 0);
                        // Update preview whenever selection changes
                        $sel.off('change.mlpreview').on('change.mlpreview', function() {
                            showMlPreview(parseFloat($(this).find('option:selected').data('rate')) || 0);
                        });
                    });
                });
            }




        });

        $('#saveMlConfig').on('click', function() {
            const liquidId = parseInt($('#ml_liquid_product_id').val()) || null;
            $.ajax({
                url: api + 'settings/ml-config',
                type: 'POST',
                data: JSON.stringify({ liquid_product_id: liquidId }),
                contentType: 'application/json',
                success: function() {
                    // Refresh mlConfig from server so getMlForPrice uses latest rate
                    $.get(api + 'settings/ml-config', function(data) {
                        if (data) mlConfig = data;
                    });
                    Swal.fire('Saved', 'ML config saved.', 'success');
                },
                error: function(xhr) {
                    Swal.fire('Error', xhr.responseText || 'Could not save ML config.', 'error');
                }
            });
        });


    });


    $('#rmv_logo').click(function () {
        $('#remove_logo').val("1");
        $('#current_logo').hide(500);
        $(this).hide(500);
        $('#logoname').show(500);
    });


    $('#rmv_img').click(function () {
        $('#remove_img').val("1");
        $('#current_img').hide(500);
        $(this).hide(500);
        $('#imagename').show(500);
    });


    $('#print_list').click(function () {

        $("#loading").show();

        if ($.fn.DataTable.isDataTable('#productList')) $('#productList').DataTable().destroy();

        const filename = 'productList.pdf';

        html2canvas($('#all_products').get(0)).then(canvas => {
            let height = canvas.height * (25.4 / 96);
            let width = canvas.width * (25.4 / 96);
            let pdf = new jsPDF('p', 'mm', 'a4');
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height);

            $("#loading").hide();
            pdf.save(filename);
        });



        $('#productList').DataTable({
            "order": [[1, "desc"]]
            , "autoWidth": false
            , "info": true
            , "JQueryUI": true
            , "ordering": true
            , "paging": false
        });

        $(".loading").hide();

    });

}


$.fn.print = function () {

    printJS({ printable: receipt, type: 'raw-html' });

}


function loadTransactions() {

    let tills = [];
    let users = [];
    let sales = 0;
    let transact = 0;
    let unique = 0;

    sold_items = [];
    sold = [];

    let counter = 0;
    let transaction_list = '';
    let query = `by-date?start=${start_date}&end=${end_date}&user=${by_user}&status=${by_status}&till=${by_till}`;


    let refill_sales = 0;
    let refill_cat = allCategories.find(c => c.name.toLowerCase() == 'refill');

    $.get(api + query, function (transactions) {

        if (transactions.length > 0) {


            $('#transaction_list').empty();
            if ($.fn.DataTable.isDataTable('#transactionList')) $('#transactionList').DataTable().destroy();

            allTransactions = [...transactions];

            transactions.forEach((trans, index) => {

                sales += parseFloat(trans.total);
                transact++;



                trans.items.forEach(item => {
                    sold_items.push(item);
                    if (refill_cat && item.category == refill_cat._id) {
                        refill_sales += parseFloat(item.price) * parseInt(item.quantity);
                    }
                });


                if (!tills.includes(trans.till)) {
                    tills.push(trans.till);
                }

                if (!users.includes(trans.user_id)) {
                    users.push(trans.user_id);
                }

                counter++;
                transaction_list += `<tr>
                                <td>${trans.order}</td>
                                <td class="nobr">${moment(trans.date).format('YYYY MMM DD hh:mm:ss')}</td>
                                <td>${settings.symbol + trans.total}</td>
                                <td>${trans.paid == "" ? "" : settings.symbol + trans.paid}</td>
                                <td>${trans.change ? settings.symbol + Math.abs(trans.change).toFixed(2) : ''}</td>
                                <td>${trans.payment_type}</td>
                                <td>${trans.till}</td>
                                <td>${trans.user}</td>
                                <td>${trans.paid == "" ? '<button class="btn btn-dark"><i class="fa fa-search-plus"></i></button>' : '<button onClick="$(this).viewTransaction(' + index + ')" class="btn btn-info"><i class="fa fa-search-plus"></i></button></td>'}</tr>
                    `;

                if (counter == transactions.length) {

                    $('#total_sales #counter').text(settings.symbol + parseFloat(sales).toFixed(2));
                    $('#total_transactions #counter').text(transact);
                    $('#total_refill #counter').text(settings.symbol + parseFloat(refill_sales).toFixed(2));

                    const result = {};

                    for (const { product_name, price, quantity, id } of sold_items) {
                        if (!result[product_name]) result[product_name] = [];
                        result[product_name].push({ id, price, quantity });
                    }

                    for (item in result) {

                        let price = 0;
                        let quantity = 0;
                        let id = 0;

                        result[item].forEach(i => {
                            id = i.id;
                            price = i.price;
                            quantity += i.quantity;
                        });

                        sold.push({
                            id: id,
                            product: item,
                            qty: quantity,
                            price: price
                        });
                    }

                    loadSoldProducts();


                    if (by_user == 0 && by_till == 0) {

                        userFilter(users);
                        tillFilter(tills);
                    }


                    $('#transaction_list').html(transaction_list);
                    $('#transactionList').DataTable({
                        "order": [[1, "desc"]]
                        , "autoWidth": false
                        , "info": true
                        , "JQueryUI": true
                        , "ordering": true
                        , "paging": true,
                        "dom": 'Bfrtip',
                        "buttons": ['csv', 'excel', 'pdf',]

                    });
                }
            });
        }
        else {
            $('#transaction_list').html('<tr><td colspan="9" class="text-center text-muted" style="padding:20px;">No transactions found for the selected date range and filters.</td></tr>');
            $('#total_sales #counter').text('0');
            $('#total_transactions #counter').text('0');
            $('#total_items #counter').text('0');
            $('#total_products #counter').text('0');
            $('#total_refill #counter').text('0');
            $('#product_sales').html('');
        }

    }).fail(function(xhr) {
        Swal.fire('Error', 'Could not load transactions: ' + (xhr.responseText || xhr.statusText || 'Server error'), 'error');
    });
}


function discend(a, b) {
    if (a.qty > b.qty) {
        return -1;
    }
    if (a.qty < b.qty) {
        return 1;
    }
    return 0;
}


function loadSoldProducts() {

    sold.sort(discend);

    let counter = 0;
    let sold_list = '';
    let items = 0;
    let products = 0;
    $('#product_sales').empty();

    sold.forEach((item, index) => {

        items += item.qty;
        products++;

        let product = allProducts.filter(function (selected) {
            return selected._id == item.id;
        });

        counter++;

        sold_list += `<tr>
            <td>${item.product}</td>
            <td>${item.qty}</td>
            <td>${(product.length > 0 && product[0].stock == 1) ? product[0].quantity : 'N/A'}</td>
            <td>${settings.symbol + (item.qty * parseFloat(item.price)).toFixed(2)}</td>
            </tr>`;

        if (counter == sold.length) {
            $('#total_items #counter').text(items);
            $('#total_products #counter').text(products);
            $('#product_sales').html(sold_list);
        }
    });
}


function userFilter(users) {

    $('#users').empty();
    $('#users').append(`<option value="0">All</option>`);

    users.forEach(user => {
        let u = allUsers.filter(function (usr) {
            return usr._id == user;
        });

        $('#users').append(`<option value="${user}">${u[0].fullname}</option>`);
    });

}


function tillFilter(tills) {

    $('#tills').empty();
    $('#tills').append(`<option value="0">All</option>`);
    tills.forEach(till => {
        $('#tills').append(`<option value="${till}">${till}</option>`);
    });

}


$.fn.viewTransaction = function (index) {

    transaction_index = index;

    let discount = allTransactions[index].discount;
    let customer = allTransactions[index].customer == 0 ? 'Walk in Customer' : allTransactions[index].customer.name;
    let refNumber = allTransactions[index].ref_number != "" ? allTransactions[index].ref_number : allTransactions[index].order;
    let orderNumber = allTransactions[index].order;
    let type = "";
    let tax_row = "";
    let items = "";
    let products = allTransactions[index].items;

    products.forEach(item => {
        items += "<tr><td>" + item.product_name + "</td><td>" + item.quantity + "</td><td>" + settings.symbol + parseFloat(item.price).toFixed(2) + "</td></tr>";

    });


    switch (allTransactions[index].payment_type) {

        case 2: type = "Card";
            break;

        default: type = "Cash";

    }


    if (allTransactions[index].paid != "") {
        payment = `<tr>
                    <td>Paid</td>
                    <td>:</td>
                    <td>${settings.symbol + allTransactions[index].paid}</td>
                </tr>
                <tr>
                    <td>Change</td>
                    <td>:</td>
                    <td>${settings.symbol + Math.abs(allTransactions[index].change).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Method</td>
                    <td>:</td>
                    <td>${type}</td>
                </tr>`
    }



    if (settings.charge_tax) {
        tax_row = `<tr>
                <td>Vat(${settings.percentage})% </td>
                <td>:</td>
                <td>${settings.symbol}${parseFloat(allTransactions[index].tax).toFixed(2)}</td>
            </tr>`;
    }



    receipt = `<div style="font-size: 10px;">                            
        <p style="text-align: center;">
        ${settings.img == "" ? settings.img : '<img style="max-width: 50px;max-width: 100px;" src ="' + img_path + settings.img + '" /><br>'}
            <span style="font-size: 22px;">${settings.store}</span> <br>
            ${settings.address_one} <br>
            ${settings.address_two} <br>
            ${settings.contact != '' ? 'Tel: ' + settings.contact + '<br>' : ''} 
            ${settings.tax != '' ? 'Vat No: ' + settings.tax + '<br>' : ''} 
    </p>
    <hr>
    <left>
        <p>
        Invoice : ${orderNumber} <br>
        Ref No : ${refNumber} <br>
        Customer : ${allTransactions[index].customer == 0 ? 'Walk in Customer' : allTransactions[index].customer.name} <br>
        Cashier : ${allTransactions[index].user} <br>
        Date : ${moment(allTransactions[index].date).format('DD MMM YYYY HH:mm:ss')}<br>
        </p>

    </left>
    <hr>
    <table width="100%">
        <thead style="text-align: left;">
        <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
        </tr>
        </thead>
        <tbody>
        ${items}                
 
        <tr>                        
            <td><b>Subtotal</b></td>
            <td>:</td>
            <td><b>${settings.symbol}${allTransactions[index].subtotal}</b></td>
        </tr>
        <tr>
            <td>Discount</td>
            <td>:</td>
            <td>${discount > 0 ? settings.symbol + parseFloat(allTransactions[index].discount).toFixed(2) : ''}</td>
        </tr>
        
        ${tax_row}
    
        <tr>
            <td><h3>Total</h3></td>
            <td><h3>:</h3></td>
            <td>
                <h3>${settings.symbol}${allTransactions[index].total}</h3>
            </td>
        </tr>
        ${payment == 0 ? '' : payment}
        </tbody>
        </table>
        <br>
        <hr>
        <br>
        <p style="text-align: center;">
         ${settings.footer}
         </p>
        </div>`;

    $('#viewTransaction').html('');
    $('#viewTransaction').html(receipt);

    $('#orderModal').modal('show');

}


$('#status').change(function () {
    by_status = $(this).find('option:selected').val();
    loadTransactions();
});



$('#tills').change(function () {
    by_till = $(this).find('option:selected').val();
    loadTransactions();
});


$('#users').change(function () {
    by_user = $(this).find('option:selected').val();
    loadTransactions();
});


$('#reportrange').on('apply.daterangepicker', function (ev, picker) {

    start = picker.startDate.format('DD MMM YYYY hh:mm A');
    end = picker.endDate.format('DD MMM YYYY hh:mm A');

    start_date = picker.startDate.startOf('day').toISOString();
    end_date = picker.endDate.endOf('day').toISOString();

    loadTransactions();
});


function authenticate() {
    $('#loading').append(
        `<div id="load">
            <div class="text-center" style="margin-bottom: 20px;">
                <img src="assets/images/hd_pos_logo.png" width="80" height="80" style="margin-bottom: 10px;">
                <h3 style="color: #f39c12; font-weight: bold; margin-top: 0;">HD POS</h3>
            </div>
            <form id="account"><div class="form-group"><input type="text" placeholder="Username" name="username" class="form-control"></div>
            <div class="form-group"><input type="password" placeholder="Password" name="password" class="form-control"></div>
            <div class="form-group"><input type="submit" class="btn btn-block btn-default" value="Login"></div></form>`
    );
}


$('body').on("submit", "#account", function (e) {
    e.preventDefault();
    let formData = $(this).serializeObject();

    if (formData.username == "" || formData.password == "") {

        Swal.fire(
            'Incomplete form!',
            auth_empty,
            'warning'
        );
    }
    else {

        $.ajax({
            url: api + 'users/login',
            type: 'POST',
            data: JSON.stringify(formData),
            contentType: 'application/json; charset=utf-8',
            cache: false,
            processData: false,
            success: function (data) {
                if (data._id) {
                    storage.set('auth', { auth: true });
                    storage.set('user', data);
                    ipcRenderer.send('app-reload', '');
                }
                else {
                    Swal.fire(
                        'Oops!',
                        auth_error,
                        'warning'
                    );
                }
            }

        });
    }
}); // End of Login Handler



$(function() {
    $("#viewLedger").on('click', function () {
        loadLedger();
    });

    $('#quit').click(function () {
        Swal.fire({
            title: 'Are you sure?',
            text: "You are about to close the application.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Close Application'
        }).then((result) => {
            if (result.value) {
                ipcRenderer.send('app-quit', '');
            }
        });
    });

    console.log("POS: Global Handlers Initialized.");
});

console.log("POS: Initialization Complete.");



