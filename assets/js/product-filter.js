$(document).ready(function () {

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/([a-z])(\d)/gi, '$1 $2')
            .replace(/(\d)([a-z])/gi, '$1 $2')
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getSearchTokens() {
        return normalizeText($("#search").val()).split(' ').filter(Boolean);
    }

    function getActiveCategoryId() {
        const $active = $("#categories .btn-categories.active");
        if ($active.length === 0 || $active.attr('id') === 'all') return 'all';
        return $active.attr('id');
    }

    function getActiveCategoryLabel() {
        const $active = $("#categories .btn-categories.active");
        if ($active.length === 0 || $active.attr('id') === 'all') return 'All categories';
        return $active.text().trim();
    }

    function matchesCategory(product, categoryId) {
        if (categoryId === 'all') return true;
        const categoryString = String(product.category || '');
        if (categoryString === String(categoryId)) return true;

        const categoryRecord = Array.isArray(window.allCategories)
            ? window.allCategories.find(c => String(c._id) === categoryString)
            : null;
        return !!(categoryRecord && String(categoryRecord.parentId || '') === String(categoryId));
    }

    function getProductFields(product) {
        return {
            name: product.name || '',
            sku: product.barcode || product.sku || product._id || '',
            brandModel: `${product.brand || ''} ${product.model || ''}`.trim(),
            flavorMeta: `${product.flavor || ''} ${product.size || ''} ${product.nicotine || ''}`.trim()
        };
    }

    function scoreField(fieldValue, tokens, weights) {
        const normalizedField = normalizeText(fieldValue);
        if (!normalizedField) {
            return { score: 0, matchedCount: 0, consecutiveFromLeft: 0 };
        }

        const normalizedQuery = tokens.join(' ');
        const fieldTokens = normalizedField.split(' ').filter(Boolean);
        const firstWord = fieldTokens[0] || '';
        let score = 0;
        let matchedCount = 0;
        let consecutiveFromLeft = 0;
        let stillMatchingFromLeft = true;

        if (normalizedQuery && normalizedField === normalizedQuery) {
            score += weights.fullQueryExact || 0;
        }
        if (normalizedQuery && normalizedField.startsWith(normalizedQuery)) {
            score += weights.fullQueryPrefix || 0;
        }

        tokens.forEach((token, tokenIndex) => {
            if (!token) return;

            if (normalizedField === token) {
                score += weights.exact || 0;
                matchedCount += 1;
                if (tokenIndex === 0) consecutiveFromLeft += 1;
                return;
            }

            if (tokenIndex === 0 && firstWord === token) {
                score += weights.firstWordExact || 0;
                matchedCount += 1;
                consecutiveFromLeft += 1;
                return;
            }

            if (tokenIndex === 0 && firstWord.startsWith(token)) {
                score += weights.firstWordPrefix || 0;
                matchedCount += 1;
                consecutiveFromLeft += 1;
                return;
            }

            const wordIndex = fieldTokens.indexOf(token);
            if (wordIndex !== -1) {
                score += weights.word || 0;
                matchedCount += 1;
                if (stillMatchingFromLeft && wordIndex === tokenIndex) {
                    consecutiveFromLeft += 1;
                } else {
                    stillMatchingFromLeft = false;
                }
                return;
            }

            const prefixWordIndex = fieldTokens.findIndex(word => word.startsWith(token));
            if (prefixWordIndex !== -1) {
                score += weights.prefix || 0;
                matchedCount += 1;
                if (stillMatchingFromLeft && prefixWordIndex === tokenIndex) {
                    consecutiveFromLeft += 1;
                } else {
                    stillMatchingFromLeft = false;
                }
                return;
            }

            if (normalizedField.includes(token)) {
                score += weights.partial || 0;
                matchedCount += 1;
                stillMatchingFromLeft = false;
                return;
            }

            stillMatchingFromLeft = false;
        });

        score += matchedCount * (weights.matchCountBonus || 0);
        score += consecutiveFromLeft * (weights.leftToRightBonus || 0);
        if (matchedCount === tokens.length) {
            score += weights.allTokensBonus || 0;
        }

        return { score, matchedCount, consecutiveFromLeft };
    }

    function scoreProduct(product, tokens, rawQuery) {
        if (tokens.length === 0) return 0;

        const fields = getProductFields(product);
        const normalizedQuery = normalizeText(rawQuery);
        const normalizedName = normalizeText(fields.name);
        const normalizedSku = normalizeText(fields.sku);
        const normalizedBrandModel = normalizeText(fields.brandModel);
        const normalizedFlavorMeta = normalizeText(fields.flavorMeta);

        const skuScore = scoreField(fields.sku, tokens, {
            exact: 3000, word: 2200, prefix: 1800, partial: 1400,
            fullQueryExact: 4500, fullQueryPrefix: 3200,
            firstWordExact: 2600, firstWordPrefix: 2100,
            matchCountBonus: 120, leftToRightBonus: 280, allTokensBonus: 500
        });
        const nameScore = scoreField(fields.name, tokens, {
            exact: 2600, word: 1800, prefix: 1500, partial: 900,
            fullQueryExact: 5200, fullQueryPrefix: 3800,
            firstWordExact: 3200, firstWordPrefix: 2400,
            matchCountBonus: 180, leftToRightBonus: 420, allTokensBonus: 900
        });
        const brandModelScore = scoreField(fields.brandModel, tokens, {
            exact: 1100, word: 750, prefix: 560, partial: 320,
            fullQueryExact: 1600, fullQueryPrefix: 1200,
            firstWordExact: 1400, firstWordPrefix: 900,
            matchCountBonus: 70, leftToRightBonus: 150, allTokensBonus: 240
        });
        const flavorScore = scoreField(fields.flavorMeta, tokens, {
            exact: 1300, word: 900, prefix: 680, partial: 360,
            fullQueryExact: 2000, fullQueryPrefix: 1450,
            firstWordExact: 1600, firstWordPrefix: 1100,
            matchCountBonus: 80, leftToRightBonus: 170, allTokensBonus: 300
        });

        let score = skuScore.score + nameScore.score + brandModelScore.score + flavorScore.score;

        if (normalizedQuery) {
            if (normalizedSku === normalizedQuery) score += 2500;
            if (normalizedName === normalizedQuery) score += 7000;
            if (normalizedName.startsWith(normalizedQuery)) score += 4200;
            if (normalizedFlavorMeta === normalizedQuery) score += 1500;
            if (normalizedBrandModel === normalizedQuery) score += 1200;
            if (normalizedName.includes(normalizedQuery)) score += 1400;
            if (normalizedFlavorMeta.includes(normalizedQuery)) score += 450;
        }

        const matchedTokenCount = tokens.filter(token => {
            const searchable = normalizeText([
                fields.name,
                fields.sku,
                fields.brandModel,
                fields.flavorMeta
            ].join(' '));
            return searchable.includes(token);
        }).length;

        if (matchedTokenCount === tokens.length) {
            score += 600;
        } else {
            score += matchedTokenCount * 75;
        }

        if (nameScore.matchedCount > 0) score += 2200;
        if (nameScore.consecutiveFromLeft > 0) score += nameScore.consecutiveFromLeft * 650;
        if (brandModelScore.consecutiveFromLeft > 0) score += brandModelScore.consecutiveFromLeft * 120;
        if (flavorScore.consecutiveFromLeft > 0) score += flavorScore.consecutiveFromLeft * 160;

        return score;
    }

    function updateSearchContext(resultCount) {
        const categoryLabel = getActiveCategoryLabel();
        const rawQuery = $("#search").val().trim();

        if (rawQuery) {
            $('#product-search-context').html(
                `Searching in <strong>${categoryLabel}</strong> for <strong>${rawQuery}</strong>. ${resultCount} result(s).`
            );
        } else {
            $('#product-search-context').html(
                `Showing products from <strong>${categoryLabel}</strong>. ${resultCount} product(s).`
            );
        }
    }

    function clearHighlights() {
        $('#parent .name, #parent .brand, #parent .flavor, #parent .sku').each(function () {
            const $node = $(this);
            const original = $node.attr('data-search-original');
            if (original !== undefined) {
                $node.html(original);
            }
        });
    }

    function highlightMatches(tokens) {
        if (tokens.length === 0) {
            clearHighlights();
            return;
        }

        const uniqueTokens = [...new Set(tokens)].sort((a, b) => b.length - a.length);

        $('#parent .name, #parent .brand, #parent .flavor, #parent .sku').each(function () {
            const $node = $(this);
            const original = $node.attr('data-search-original');
            if (original === undefined) {
                $node.attr('data-search-original', $node.html());
            }
            const source = $node.attr('data-search-original') || $node.html();
            let highlighted = source;

            uniqueTokens.forEach(token => {
                if (!token) return;
                const matcher = new RegExp('(' + escapeRegExp(token) + ')', 'ig');
                highlighted = highlighted.replace(matcher, '<mark>$1</mark>');
            });

            $node.html(highlighted);
        });
    }

    function applyProductFilters() {
        const products = Array.isArray(window.allProducts) ? window.allProducts : [];
        const rawQuery = $("#search").val();
        const tokens = getSearchTokens();
        const activeCategoryId = getActiveCategoryId();

        let filteredProducts = products.filter(product => matchesCategory(product, activeCategoryId));

        if (tokens.length > 0) {
            filteredProducts = filteredProducts
                .map((product, index) => ({
                    product,
                    index,
                    score: scoreProduct(product, tokens, rawQuery)
                }))
                .filter(entry => entry.score > 0)
                .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    const aName = normalizeText(a.product.name);
                    const bName = normalizeText(b.product.name);
                    if (aName !== bName) return aName.localeCompare(bName);
                    return a.index - b.index;
                })
                .map(entry => entry.product);
        }

        if (typeof window.renderProductGrid === 'function') {
            window.renderProductGrid(filteredProducts);
        }

        highlightMatches(tokens);
        updateSearchContext(filteredProducts.length);
    }

    $('#categories').on('click', '.btn-categories', function () {
        $("#categories .btn-categories").removeClass("active");
        $(this).addClass('active');
        applyProductFilters();
    });

    $("#search").on('input', function () {
        applyProductFilters();
    });

    $('body').on('click', '#jq-keyboard button', function () {
        if ($("#search").is(":focus")) {
            applyProductFilters();
        }
    });

    function searchOpenOrders() {
        const matcher = new RegExp($("#holdOrderInput").val(), 'gi');
        $('.order').show().not(function () {
            return matcher.test($(this).find('.ref_number').text());
        }).hide();
    }

    $("#holdOrderInput").on('input', function () {
        searchOpenOrders();
    });

    $('body').on('click', '.holdOrderKeyboard .key', function () {
        if ($("#holdOrderInput").is(":focus")) {
            searchOpenOrders();
        }
    });

    function searchCustomerOrders() {
        const matcher = new RegExp($("#holdCustomerOrderInput").val(), 'gi');
        $('.customer-order').show().not(function () {
            return matcher.test($(this).find('.customer_name').text());
        }).hide();
    }

    $("#holdCustomerOrderInput").on('input', function () {
        searchCustomerOrders();
    });

    $('body').on('click', '.customerOrderKeyboard .key', function () {
        if ($("#holdCustomerOrderInput").is(":focus")) {
            searchCustomerOrders();
        }
    });

    setTimeout(function () {
        if ($("#categories .btn-categories.active").length === 0) {
            $('#categories .btn-categories#all').addClass('active');
        }
        updateSearchContext(Array.isArray(window.allProducts) ? window.allProducts.length : 0);
    }, 0);
});
