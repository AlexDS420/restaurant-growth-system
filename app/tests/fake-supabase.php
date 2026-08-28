<?php
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$query = []; parse_str((string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_QUERY) ?? ''), $query);
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$table = basename($path);
header('Content-Type: application/json');
$body = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$venue = ['id'=>'11111111-1111-4111-8111-111111111111','name'=>'Casa Lima','slug'=>'casa-lima','currency'=>'PEN','timezone'=>'America/Lima','status'=>'active'];
$product = ['id'=>'22222222-2222-4222-8222-222222222222','venue_id'=>$venue['id'],'category_id'=>'44444444-4444-4444-8444-444444444444','name'=>'Ceviche','price_minor'=>2500,'promo_price_minor'=>null,'is_visible'=>true,'is_available'=>true];
$order = ['id'=>'33333333-3333-4333-8333-333333333333','venue_id'=>$venue['id'],'public_token'=>'public-test-token','total_minor'=>2950,'subtotal_minor'=>2500,'tax_minor'=>450,'payment_status'=>'unpaid'];
if ($method === 'GET' && $table === 'venues') echo json_encode([$venue]);
elseif ($method === 'GET' && $table === 'menu_categories') echo json_encode([['id'=>'44444444-4444-4444-8444-444444444444','venue_id'=>$venue['id'],'name'=>'Entradas','is_visible'=>true]]);
elseif ($method === 'GET' && $table === 'menu_products') echo json_encode([$product]);
elseif ($method === 'GET' && $table === 'orders') echo json_encode(isset($query['public_token']) ? [$order] : []);
elseif ($method === 'POST' && $table === 'orders') echo json_encode([$order]);
elseif ($method === 'POST' && $table === 'order_items') echo json_encode([$body]);
elseif ($method === 'GET' && $table === 'payments') echo json_encode([]);
elseif ($method === 'POST' && $table === 'payments') echo json_encode([array_merge($body, ['id'=>'55555555-5555-4555-8555-555555555555'])]);
else { http_response_code(404); echo json_encode(['error'=>'fake route']); }
