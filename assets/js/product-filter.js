$(document).ready(function(){

    $('#categories').on('click', '.btn-categories', function(){

        if (this.id == 'all') {
            $('#parent > div').fadeIn(450);
        } else {
            var $el = $('.' + this.id).fadeIn(450);
            $('#parent > div').not($el).hide();
        }
 
        $("#categories .btn-categories").removeClass("active");
        $(this).addClass('active');

    });

 
    function searchProducts () {        
        $("#categories .btn-categories").removeClass("active");
        var matcher = new RegExp($("#search").val(), 'gi');
        $('.box').show().not(function(){
            return matcher.test($(this).find('.name, .sku').text())
        }).hide();
    }

    let $search = $("#search").on('input',function(){
        searchProducts();       
    });


    $('body').on('click', '#jq-keyboard button', function(e) {
        if($("#search").is(":focus")) {
            searchProducts(); 
        }          
    });


    function searchOpenOrders() {
        var matcher = new RegExp($("#holdOrderInput").val(), 'gi');
        $('.order').show().not(function(){
            return matcher.test($(this).find('.ref_number').text())
        }).hide();

    }

    var $searchHoldOrder = $("#holdOrderInput").on('input',function () {
        searchOpenOrders();
    });


    $('body').on('click', '.holdOrderKeyboard .key', function() {
        if($("#holdOrderInput").is(":focus")) {
            searchOpenOrders(); 
        }          
    });
 
  
    function searchCustomerOrders() {
        var matcher = new RegExp($("#holdCustomerOrderInput").val(), 'gi');
        $('.customer-order').show().not(function(){
            return matcher.test($(this).find('.customer_name').text())
        }).hide();
    }

    var $searchCustomerOrder = $("#holdCustomerOrderInput").on('input',function () {
        searchCustomerOrders();
    });


    $('body').on('click', '.customerOrderKeyboard .key', function() {
        if($("#holdCustomerOrderInput").is(":focus")) {
            searchCustomerOrders();
        }          
    });
 


    // Payment logic moved to pos.js to avoid conflicts
});