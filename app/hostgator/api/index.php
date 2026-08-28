<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

try {
    $method = request_method(); $path = request_path();
    if ($method === 'GET' && $path === '/api/v1/healthz') {
        $configured = trim((string)env_value('SUPABASE_URL', '')) !== '' && trim((string)env_value('SUPABASE_SERVICE_ROLE_KEY', '')) !== '';
        respond(['status' => $configured ? 'ready' : 'degraded', 'supabase_configured' => $configured], $configured ? 200 : 503);
    }
    $db = SupabaseRest::fromEnv();
    if ($method === 'GET' && preg_match('#^/api/v1/public/venues/([^/]+)/menu$#', $path, $m)) {
        $slug = rawurldecode($m[1]); $venues = $db->query('ros_venues', ['slug' => 'eq.' . rawurlencode($slug), 'status' => 'eq.active', 'select' => '*', 'limit' => '1']);
        if (!$venues) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.'); $venue = $venues[0];
        $cats = $db->query('ros_menu_categories', ['venue_id' => 'eq.' . $venue['id'], 'is_visible' => 'eq.true', 'order' => 'sort_order.asc']);
        $products = $db->query('ros_menu_products', ['venue_id' => 'eq.' . $venue['id'], 'is_visible' => 'eq.true', 'is_available' => 'eq.true', 'deleted_at' => 'is.null', 'order' => 'sort_order.asc']);
        $categories = array_map(static function (array $category) use ($products): array {
            $category['products'] = array_values(array_filter($products, static fn(array $product): bool => (string)($product['category_id'] ?? '') === (string)$category['id']));
            return $category;
        }, $cats);
        respond(['venue' => ['id' => $venue['id'], 'name' => $venue['name'], 'slug' => $venue['slug'], 'currency' => $venue['currency'] ?? 'PEN', 'timezone' => $venue['timezone'] ?? 'America/Lima'], 'categories' => $categories, 'option_groups' => []]);
    }
    if ($method === 'GET' && preg_match('#^/api/v1/public/venues/([^/]+)$#', $path, $m)) {
        $rows = $db->query('ros_venues', ['slug' => 'eq.' . rawurlencode(rawurldecode($m[1])), 'status' => 'eq.active', 'select' => '*', 'limit' => '1']);
        if (!$rows) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.'); respond($rows[0]);
    }
    if ($method === 'POST' && preg_match('#^/api/v1/public/venues/([^/]+)/orders$#', $path, $m)) {
        $body = json_body(); $slug = rawurldecode($m[1]); $venues = $db->query('ros_venues', ['slug' => 'eq.' . rawurlencode($slug), 'status' => 'eq.active', 'select' => 'id,name,slug,currency', 'limit' => '1']);
        if (!$venues) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
        $items = $body['items'] ?? null; if (!is_array($items) || count($items) < 1 || count($items) > 50) throw new ApiException(422, 'ITEMS_INVALID', 'El pedido debe tener entre 1 y 50 productos.');
        $venueId = (string)$venues[0]['id']; $idempotency = trim((string)($body['idempotency_key'] ?? ''));
        if ($idempotency !== '' && strlen($idempotency) <= 120) {
            $existing = $db->query('ros_orders', ['venue_id'=>'eq.'.rawurlencode($venueId), 'idempotency_key'=>'eq.'.rawurlencode($idempotency), 'select'=>'*', 'limit'=>'1']);
            if ($existing) respond($existing[0]);
        }
        $productIds = array_values(array_unique(array_map(static fn($item): string => (string)($item['product_id'] ?? ''), $items)));
        if (count($productIds) !== count(array_filter($productIds, static fn(string $id): bool => preg_match('/^[0-9a-f-]{36}$/i', $id) === 1))) throw new ApiException(422, 'PRODUCT_ID_INVALID', 'Uno de los productos no es válido.');
        $products = $db->query('ros_menu_products', ['venue_id'=>'eq.'.rawurlencode($venueId), 'id'=>'in.(' . implode(',', array_map('rawurlencode', $productIds)) . ')', 'is_visible'=>'eq.true', 'is_available'=>'eq.true', 'deleted_at'=>'is.null', 'select'=>'id,name,price_minor,promo_price_minor']);
        $byId = []; foreach ($products as $product) $byId[(string)$product['id']] = $product;
        if (count($byId) !== count($productIds)) throw new ApiException(422, 'PRODUCT_UNAVAILABLE', 'Uno de los productos ya no está disponible.');
        $subtotal = 0; $rows = [];
        foreach ($items as $item) {
            $productId = (string)($item['product_id'] ?? ''); $qty = filter_var($item['quantity'] ?? 0, FILTER_VALIDATE_INT);
            if ($qty === false || $qty < 1 || $qty > 99) throw new ApiException(422, 'QUANTITY_INVALID', 'La cantidad de un producto no es válida.');
            $product = $byId[$productId]; $unit = (int)($product['promo_price_minor'] ?? 0) > 0 ? (int)$product['promo_price_minor'] : (int)$product['price_minor']; $line = $unit * $qty; $subtotal += $line;
            $rows[] = ['venue_id'=>$venueId, 'product_id'=>$productId, 'name_snapshot'=>$product['name'], 'unit_price_minor'=>$unit, 'quantity'=>$qty, 'line_total_minor'=>$line, 'options_snapshot'=>is_array($item['option_ids'] ?? null) ? $item['option_ids'] : [], 'notes'=>substr((string)($item['notes'] ?? ''), 0, 500)];
        }
        $fulfillment = $body['fulfillment'] ?? []; $type = (string)($fulfillment['type'] ?? 'pickup'); if (!in_array($type, ['pickup','delivery'], true)) throw new ApiException(422, 'FULFILLMENT_INVALID', 'Método de entrega no válido.');
        if ($type === 'delivery' && trim((string)($fulfillment['address'] ?? '')) === '') throw new ApiException(422, 'ADDRESS_REQUIRED', 'La dirección es obligatoria para delivery.');
        $fee = 0; $tax = intdiv($subtotal * 18, 100); $total = $subtotal + $tax + $fee;
        $customer = $body['customer'] ?? []; if (!is_array($customer)) $customer = [];
        $orderRows = $db->insert('ros_orders', ['venue_id'=>$venueId, 'public_token'=>bin2hex(random_bytes(18)), 'customer_name'=>require_string(['customer_name'=>$customer['name'] ?? ''], 'customer_name'), 'customer_phone'=>require_string(['customer_phone'=>$customer['phone'] ?? ''], 'customer_phone', 40), 'customer_email'=>filter_var((string)($customer['email'] ?? ''), FILTER_VALIDATE_EMAIL) ?: null, 'fulfillment_type'=>$type, 'address'=>substr((string)($fulfillment['address'] ?? ''), 0, 300), 'reference'=>substr((string)($fulfillment['reference'] ?? ''), 0, 200), 'status'=>'pending', 'payment_status'=>'unpaid', 'notes'=>substr((string)($body['notes'] ?? ''), 0, 1000), 'subtotal_minor'=>$subtotal, 'tax_minor'=>$tax, 'delivery_fee_minor'=>$fee, 'total_minor'=>$total, 'currency'=>'PEN', 'idempotency_key'=>$idempotency !== '' ? $idempotency : null]);
        $order = $orderRows[0] ?? []; if (empty($order['id'])) throw new ApiException(502, 'ORDER_CREATE_FAILED', 'No se pudo crear el pedido.'); foreach ($rows as &$row) $row['order_id'] = $order['id']; unset($row); $db->insert('ros_order_items', $rows[0]); foreach (array_slice($rows, 1) as $row) $db->insert('ros_order_items', $row);
        $order['totals'] = ['subtotal_minor'=>$subtotal, 'tax_minor'=>$tax, 'delivery_fee_minor'=>$fee, 'total_minor'=>$total]; respond($order, 201);
    }
    if ($method === 'POST' && preg_match('#^/api/v1/public/venues/([^/]+)/orders/([^/]+)/pay$#', $path, $m)) {
        $body = json_body(); $methodName = strtolower(trim((string)($body['payment_method'] ?? '')));
        if (!in_array($methodName, ['yape','plin'], true)) throw new ApiException(422, 'PAYMENT_METHOD_INVALID', 'Selecciona Yape o Plin.');
        $operation = trim((string)($body['operation_code'] ?? '')); if ($operation === '' || strlen($operation) > 80) throw new ApiException(422, 'OPERATION_CODE_REQUIRED', 'Ingresa el código de operación.');
        $orders = $db->query('ros_orders', ['public_token' => 'eq.' . rawurlencode($m[2]), 'select' => 'id,venue_id,total_minor,payment_status', 'limit' => '1']); if (!$orders) throw new ApiException(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.'); $order = $orders[0];
        if (($order['payment_status'] ?? '') === 'paid') throw new ApiException(409, 'PAYMENT_ALREADY_PROCESSED', 'Este pedido ya figura como pagado.');
        $payment = $db->insert('ros_payments', ['order_id' => $order['id'], 'venue_id' => $order['venue_id'], 'method' => $methodName, 'provider' => $methodName, 'amount_minor' => (int)$order['total_minor'], 'status' => 'verifying', 'operation_code' => $operation, 'external_ref' => $operation]);
        respond(['payment' => $payment[0] ?? $payment, 'payment_status' => 'pending_verification', 'message' => 'Pago recibido para verificación del negocio.'], 201);
    }
    if ($method === 'POST' && $path === '/api/v1/auth/login') {
        $body = json_body(); $email = strtolower(trim(require_string($body, 'email', 254))); $password = (string)($body['password'] ?? '');
        if ($password === '') throw new ApiException(422, 'PASSWORD_REQUIRED', 'Ingresa tu contraseña.');
        $auth = $db->signIn($email, $password); $access = (string)($auth['access_token'] ?? '');
        if ($access === '') throw new ApiException(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
        setcookie('ros_access_token', $access, ['httponly'=>true, 'secure'=>!empty($_SERVER['HTTPS']), 'samesite'=>'Lax', 'path'=>'/', 'expires'=>time()+((int)($auth['expires_in'] ?? 3600))]);
        $user = session_user($db); if (!$user) throw new ApiException(403, 'NO_VENUE_ACCESS', 'Tu cuenta no tiene un restaurante activo asignado.');
        $_SESSION['csrf'] = bin2hex(random_bytes(32)); respond(['user' => $user, 'csrf_token' => $_SESSION['csrf']]);
    }
    if ($method === 'POST' && $path === '/api/v1/auth/logout') { require_csrf(); setcookie('ros_access_token', '', ['expires'=>time()-3600, 'httponly'=>true, 'samesite'=>'Lax', 'path'=>'/']); session_destroy(); respond(['logged_out'=>true]); }
    if ($method === 'GET' && $path === '/api/v1/me') { respond(['user' => require_session($db)]); }
    if ($method === 'GET' && $path === '/api/v1/orders') {
        $user = require_role($db, ['owner', 'manager', 'kitchen', 'cashier', 'viewer']);
        $query = $_GET;
        $allowedStatuses = ['pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
        $allowedPayments = ['unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'];
        $allowedFulfillment = ['pickup', 'delivery'];
        $params = [
            'venue_id' => 'eq.' . rawurlencode((string)$user['venue_id']),
            'select' => 'id,venue_id,public_token,customer_name,customer_phone,customer_email,status,payment_status,fulfillment_type,address,reference,notes,subtotal_minor,tax_minor,discount_minor,delivery_fee_minor,total_minor,currency,placed_at,updated_at',
            'order' => 'placed_at.desc',
            'limit' => '200',
        ];
        foreach ([['status', $allowedStatuses], ['payment', $allowedPayments], ['fulfillment', $allowedFulfillment]] as [$key, $allowed]) {
            if (!isset($query[$key]) || $query[$key] === '') continue;
            $value = trim((string)$query[$key]);
            if (!in_array($value, $allowed, true)) throw new ApiException(422, 'FILTER_INVALID', "El filtro {$key} no es válido.");
            $column = $key === 'payment' ? 'payment_status' : ($key === 'fulfillment' ? 'fulfillment_type' : $key);
            $params[$column] = 'eq.' . rawurlencode($value);
        }
        $date = trim((string)($query['date'] ?? ''));
        if ($date !== '') {
            $tz = new DateTimeZone('America/Lima'); $now = new DateTimeImmutable('now', $tz);
            if ($date === 'today') { $from = $now->setTime(0, 0); $to = $from->modify('+1 day'); }
            elseif ($date === 'yesterday') { $to = $now->setTime(0, 0); $from = $to->modify('-1 day'); }
            elseif ($date === 'week') { $from = $now->modify('-7 days'); $to = null; }
            else throw new ApiException(422, 'FILTER_INVALID', 'El filtro date no es válido.');
            $fromIso = $from->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s\\Z');
            if ($to !== null) {
                $toIso = $to->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s\\Z');
                $params['and'] = '(placed_at.gte.' . $fromIso . ',placed_at.lt.' . $toIso . ')';
            } else $params['placed_at'] = 'gte.' . $fromIso;
        }
        $term = trim((string)($query['q'] ?? ''));
        if ($term !== '') {
            if (mb_strlen($term) > 80 || preg_match('/[^\\p{L}\\p{N} @.\\-_+]/u', $term)) throw new ApiException(422, 'FILTER_INVALID', 'La búsqueda contiene caracteres no permitidos.');
            $wildcard = '*' . $term . '*';
            $params['or'] = '(customer_name.ilike.' . $wildcard . ',customer_phone.ilike.' . $wildcard . ')';
        }
        $orders = $db->query('ros_orders', $params);
        if (!$orders) { respond([]); }
        $ids = array_values(array_filter(array_map(static fn(array $row): string => (string)($row['id'] ?? ''), $orders), static fn(string $id): bool => preg_match('/^[0-9a-f-]{36}$/i', $id) === 1));
        $itemsByOrder = [];
        if ($ids) {
            $items = $db->query('ros_order_items', [
                'order_id' => 'in.(' . implode(',', array_map('rawurlencode', $ids)) . ')',
                'select' => 'order_id,name_snapshot,quantity,unit_price_minor,line_total_minor,options_snapshot,notes',
            ]);
            foreach ($items as $item) {
                $snapshot = $item['options_snapshot'] ?? [];
                if (is_string($snapshot)) $snapshot = json_decode($snapshot, true) ?: [];
                $itemsByOrder[(string)$item['order_id']][] = [
                    'name' => $item['name_snapshot'] ?? '', 'qty' => (int)($item['quantity'] ?? 0),
                    'unit_price_minor' => (int)($item['unit_price_minor'] ?? 0), 'line_total_minor' => (int)($item['line_total_minor'] ?? 0),
                    'options' => is_array($snapshot) ? $snapshot : [], 'notes' => $item['notes'] ?? null,
                ];
            }
        }
        $result = array_map(static function (array $order) use ($itemsByOrder): array {
            $id = (string)$order['id'];
            $order['customer'] = ['name' => $order['customer_name'] ?? '', 'phone' => $order['customer_phone'] ?? '', 'email' => $order['customer_email'] ?? null];
            $order['totals'] = ['subtotal_minor'=>(int)($order['subtotal_minor'] ?? 0), 'tax_minor'=>(int)($order['tax_minor'] ?? 0), 'discount_minor'=>(int)($order['discount_minor'] ?? 0), 'delivery_fee_minor'=>(int)($order['delivery_fee_minor'] ?? 0), 'total_minor'=>(int)($order['total_minor'] ?? 0), 'currency'=>$order['currency'] ?? 'PEN'];
            $order['items'] = $itemsByOrder[$id] ?? [];
            unset($order['customer_name'], $order['customer_phone'], $order['customer_email'], $order['subtotal_minor'], $order['tax_minor'], $order['discount_minor'], $order['delivery_fee_minor'], $order['total_minor']);
            return $order;
        }, $orders);
        respond($result);
    }
    if ($method === 'POST' && preg_match('#^/api/v1/payments/([^/]+)/confirm$#', $path, $m)) {
        require_csrf(); $user = require_role($db, ['owner','manager','cashier']); $body = json_body(); $status = (string)($body['status'] ?? '');
        if (!in_array($status, ['confirmed', 'rejected'], true)) throw new ApiException(422, 'STATUS_INVALID', 'El estado de conciliación no es válido.');
        $rows = $db->update('ros_payments', ['id' => 'eq.' . rawurlencode($m[1]), 'venue_id' => 'eq.' . rawurlencode((string)$user['venue_id']), 'status' => 'eq.verifying'], ['status' => $status, 'confirmed_by' => $user['id'], 'confirmed_at' => gmdate('c'), 'failure_reason' => $status === 'rejected' ? substr((string)($body['note'] ?? ''), 0, 500) : null]);
        if (!$rows) throw new ApiException(409, 'PAYMENT_ALREADY_VERIFIED', 'El pago ya fue conciliado.');
        $payment = $rows[0] ?? []; if (!empty($payment['order_id'])) $db->update('ros_orders', ['id' => 'eq.' . rawurlencode((string)$payment['order_id']), 'venue_id' => 'eq.' . rawurlencode((string)$user['venue_id'])], ['payment_status' => $status === 'confirmed' ? 'paid' : 'failed']);
        $db->insert('ros_audit_logs', ['venue_id'=>$user['venue_id'], 'actor_user_id'=>$user['id'], 'action'=>'payment.' . $status, 'entity_type'=>'payment', 'entity_id'=>$payment['id'] ?? $m[1], 'after_data'=>['status'=>$status, 'order_id'=>$payment['order_id'] ?? null]]);
        respond($payment);
    }
    if ($method === 'GET' && $path === '/api/v1/payments/reconciliation') { $user = require_role($db, ['owner','manager','cashier']); $rows = $db->query('ros_payments', ['venue_id'=>'eq.'.rawurlencode((string)$user['venue_id']), 'method'=>'in.(yape,plin)', 'select'=>'id,order_id,method,provider,amount_minor,operation_code,external_ref,status,created_at,confirmed_at,failure_reason', 'order'=>'created_at.desc', 'limit'=>'200']); respond(['payments'=>$rows, 'pending_count'=>count(array_filter($rows, static fn(array $r): bool => ($r['status'] ?? '') === 'verifying'))]); }
    throw new ApiException(404, 'NOT_FOUND', 'Ruta no encontrada.');
} catch (ApiException $e) { fail($e); } catch (Throwable $e) { error_log($e->getMessage()); fail(new ApiException(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')); }
