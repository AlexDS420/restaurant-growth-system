<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

try {
    $db = SupabaseRest::fromEnv(); $method = request_method(); $path = request_path();
    if ($method === 'GET' && preg_match('#^/api/v1/public/venues/([^/]+)/menu$#', $path, $m)) {
        $slug = rawurldecode($m[1]); $venues = $db->query('venues', ['slug' => 'eq.' . rawurlencode($slug), 'status' => 'eq.active', 'select' => '*', 'limit' => '1']);
        if (!$venues) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.'); $venue = $venues[0];
        $cats = $db->query('menu_categories', ['venue_id' => 'eq.' . $venue['id'], 'is_visible' => 'eq.true', 'deleted_at' => 'is.null', 'order' => 'sort_order.asc']);
        $products = $db->query('menu_products', ['venue_id' => 'eq.' . $venue['id'], 'is_visible' => 'eq.true', 'is_available' => 'eq.true', 'deleted_at' => 'is.null', 'order' => 'sort_order.asc']);
        $categories = array_map(static function (array $category) use ($products): array {
            $category['products'] = array_values(array_filter($products, static fn(array $product): bool => (string)($product['category_id'] ?? '') === (string)$category['id']));
            return $category;
        }, $cats);
        respond(['venue' => ['id' => $venue['id'], 'name' => $venue['name'], 'slug' => $venue['slug'], 'currency' => $venue['currency'] ?? 'PEN', 'timezone' => $venue['timezone'] ?? 'America/Lima'], 'categories' => $categories, 'option_groups' => []]);
    }
    if ($method === 'GET' && preg_match('#^/api/v1/public/venues/([^/]+)$#', $path, $m)) {
        $rows = $db->query('venues', ['slug' => 'eq.' . rawurlencode(rawurldecode($m[1])), 'status' => 'eq.active', 'select' => '*', 'limit' => '1']);
        if (!$rows) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.'); respond($rows[0]);
    }
    if ($method === 'POST' && preg_match('#^/api/v1/public/venues/([^/]+)/orders$#', $path, $m)) {
        $body = json_body(); $slug = rawurldecode($m[1]); $venues = $db->query('venues', ['slug' => 'eq.' . rawurlencode($slug), 'status' => 'eq.active', 'select' => 'id,name,slug,currency', 'limit' => '1']);
        if (!$venues) throw new ApiException(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
        $items = $body['items'] ?? null; if (!is_array($items) || count($items) < 1 || count($items) > 50) throw new ApiException(422, 'ITEMS_INVALID', 'El pedido debe tener entre 1 y 50 productos.');
        $venueId = (string)$venues[0]['id']; $idempotency = trim((string)($body['idempotency_key'] ?? ''));
        if ($idempotency !== '' && strlen($idempotency) <= 120) {
            $existing = $db->query('orders', ['venue_id'=>'eq.'.rawurlencode($venueId), 'idempotency_key'=>'eq.'.rawurlencode($idempotency), 'select'=>'*', 'limit'=>'1']);
            if ($existing) respond($existing[0]);
        }
        $productIds = array_values(array_unique(array_map(static fn($item): string => (string)($item['product_id'] ?? ''), $items)));
        if (count($productIds) !== count(array_filter($productIds, static fn(string $id): bool => preg_match('/^[0-9a-f-]{36}$/i', $id) === 1))) throw new ApiException(422, 'PRODUCT_ID_INVALID', 'Uno de los productos no es válido.');
        $products = $db->query('menu_products', ['venue_id'=>'eq.'.rawurlencode($venueId), 'id'=>'in.(' . implode(',', array_map('rawurlencode', $productIds)) . ')', 'is_visible'=>'eq.true', 'is_available'=>'eq.true', 'deleted_at'=>'is.null', 'select'=>'id,name,price_minor,promo_price_minor']);
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
        $orderRows = $db->insert('orders', ['venue_id'=>$venueId, 'public_token'=>bin2hex(random_bytes(18)), 'customer_name'=>require_string(['customer_name'=>$customer['name'] ?? ''], 'customer_name'), 'customer_phone'=>require_string(['customer_phone'=>$customer['phone'] ?? ''], 'customer_phone', 40), 'customer_email'=>filter_var((string)($customer['email'] ?? ''), FILTER_VALIDATE_EMAIL) ?: null, 'fulfillment_type'=>$type, 'address'=>substr((string)($fulfillment['address'] ?? ''), 0, 300), 'reference'=>substr((string)($fulfillment['reference'] ?? ''), 0, 200), 'status'=>'pending', 'payment_status'=>'unpaid', 'notes'=>substr((string)($body['notes'] ?? ''), 0, 1000), 'subtotal_minor'=>$subtotal, 'tax_minor'=>$tax, 'delivery_fee_minor'=>$fee, 'total_minor'=>$total, 'currency'=>'PEN', 'idempotency_key'=>$idempotency !== '' ? $idempotency : null]);
        $order = $orderRows[0] ?? []; if (empty($order['id'])) throw new ApiException(502, 'ORDER_CREATE_FAILED', 'No se pudo crear el pedido.'); foreach ($rows as &$row) $row['order_id'] = $order['id']; unset($row); $db->insert('order_items', $rows[0]); foreach (array_slice($rows, 1) as $row) $db->insert('order_items', $row);
        $order['totals'] = ['subtotal_minor'=>$subtotal, 'tax_minor'=>$tax, 'delivery_fee_minor'=>$fee, 'total_minor'=>$total]; respond($order, 201);
    }
    if ($method === 'POST' && preg_match('#^/api/v1/public/venues/([^/]+)/orders/([^/]+)/pay$#', $path, $m)) {
        $body = json_body(); $methodName = strtolower(trim((string)($body['payment_method'] ?? '')));
        if (!in_array($methodName, ['yape','plin'], true)) throw new ApiException(422, 'PAYMENT_METHOD_INVALID', 'Selecciona Yape o Plin.');
        $operation = trim((string)($body['operation_code'] ?? '')); if ($operation === '' || strlen($operation) > 80) throw new ApiException(422, 'OPERATION_CODE_REQUIRED', 'Ingresa el código de operación.');
        $orders = $db->query('orders', ['public_token' => 'eq.' . rawurlencode($m[2]), 'select' => 'id,venue_id,total_minor,payment_status', 'limit' => '1']); if (!$orders) throw new ApiException(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.'); $order = $orders[0];
        if (($order['payment_status'] ?? '') === 'paid') throw new ApiException(409, 'PAYMENT_ALREADY_PROCESSED', 'Este pedido ya figura como pagado.');
        $payment = $db->insert('payments', ['order_id' => $order['id'], 'venue_id' => $order['venue_id'], 'method' => $methodName, 'provider' => $methodName, 'amount_minor' => (int)$order['total_minor'], 'status' => 'verifying', 'operation_code' => $operation, 'external_ref' => $operation]);
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
    if ($method === 'POST' && preg_match('#^/api/v1/payments/([^/]+)/confirm$#', $path, $m)) {
        require_csrf(); $user = require_session($db); if (!in_array($user['role'], ['owner','manager','cashier'], true)) throw new ApiException(403, 'FORBIDDEN', 'No tienes permiso para confirmar pagos.'); $body = json_body(); $status = ($body['status'] ?? '') === 'rejected' ? 'rejected' : 'confirmed';
        $rows = $db->update('payments', ['id' => 'eq.' . rawurlencode($m[1]), 'venue_id' => 'eq.' . rawurlencode((string)$user['venue_id']), 'status' => 'eq.verifying'], ['status' => $status, 'confirmed_by' => $user['id'], 'confirmed_at' => gmdate('c'), 'failure_reason' => $status === 'rejected' ? substr((string)($body['note'] ?? ''), 0, 500) : null]);
        if (!$rows) throw new ApiException(409, 'PAYMENT_ALREADY_VERIFIED', 'El pago ya fue conciliado.');
        $payment = $rows[0] ?? []; if (!empty($payment['order_id'])) $db->update('orders', ['id' => 'eq.' . rawurlencode((string)$payment['order_id']), 'venue_id' => 'eq.' . rawurlencode((string)$user['venue_id'])], ['payment_status' => $status === 'confirmed' ? 'paid' : 'failed']);
        respond($payment);
    }
    if ($method === 'GET' && $path === '/api/v1/payments/reconciliation') { $user = require_session($db); $rows = $db->query('payments', ['venue_id'=>'eq.'.rawurlencode((string)$user['venue_id']), 'method'=>'in.(yape,plin)', 'select'=>'id,order_id,method,provider,amount_minor,operation_code,external_ref,status,created_at,confirmed_at', 'order'=>'created_at.desc']); respond(['payments'=>$rows, 'pending_count'=>count(array_filter($rows, static fn(array $r): bool => ($r['status'] ?? '') === 'verifying'))]); }
    throw new ApiException(404, 'NOT_FOUND', 'Ruta no encontrada.');
} catch (ApiException $e) { fail($e); } catch (Throwable $e) { error_log($e->getMessage()); fail(new ApiException(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.')); }
