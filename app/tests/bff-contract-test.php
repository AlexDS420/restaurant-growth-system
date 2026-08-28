<?php
declare(strict_types=1);

/** Contract test: only localhost fake REST; no credentials or external network. */
$root = dirname(__DIR__); $fakePort = random_int(18000, 18999); $apiPort = random_int(19000, 19999); $php = PHP_BINARY;
$fake = proc_open([$php, '-S', '127.0.0.1:'.$fakePort, '-t', basename(__DIR__), basename(__DIR__).'/fake-supabase.php'], [1=>['pipe','w'], 2=>['pipe','w']], $fakePipes, $root, $_ENV);
$env = array_merge($_ENV, ['SUPABASE_URL'=>'http://127.0.0.1:'.$fakePort, 'SUPABASE_SERVICE_ROLE_KEY'=>'TEST_ONLY_NOT_SECRET']);
$apiEnv = $env;
$api = proc_open([$php, '-S', '127.0.0.1:'.$apiPort, 'hostgator/api/index.php'], [1=>['pipe','w'], 2=>['pipe','w']], $apiPipes, $root, $apiEnv);
register_shutdown_function(static function () use (&$fake, &$api): void { foreach ([$fake, $api] as $process) if (is_resource($process)) proc_terminate($process); });
usleep(350000);
function call_api(int $port, string $method, string $path, ?array $body = null): array
{
    $ch = curl_init('http://127.0.0.1:'.$port.$path); if ($ch === false) throw new RuntimeException('curl init');
    $headers = ['Content-Type: application/json']; curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST=>$method, CURLOPT_RETURNTRANSFER=>true, CURLOPT_HTTPHEADER=>$headers, CURLOPT_POSTFIELDS=>$body === null ? null : json_encode($body, JSON_THROW_ON_ERROR)]);
    $raw = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); return [$status, json_decode((string)$raw, true) ?: []];
}
function check_true(bool $condition, string $message): void { if (!$condition) throw new RuntimeException('FAIL: '.$message); echo 'OK: '.$message.PHP_EOL; }
try {
    [$status, $health] = call_api($apiPort, 'GET', '/api/v1/healthz'); check_true($status === 200 && ($health['data']['supabase_configured'] ?? false) === true, 'healthz reporta Supabase configurado');
    [$status, $menu] = call_api($apiPort, 'GET', '/api/v1/public/venues/casa-lima/menu'); check_true($status === 200 && ($menu['data']['categories'][0]['products'][0]['price_minor'] ?? 0) === 2500, 'GET menú usa Supabase: '.json_encode([$status, $menu], JSON_UNESCAPED_UNICODE));
    [$status, $created] = call_api($apiPort, 'POST', '/api/v1/public/venues/casa-lima/orders', ['items'=>[['product_id'=>'22222222-2222-4222-8222-222222222222','quantity'=>1,'unit_price_minor'=>1]],'idempotency_key'=>'test-key','customer'=>['name'=>'Cliente','phone'=>'999999999'],'fulfillment'=>['type'=>'pickup']]);
    check_true($status === 201 && ($created['data']['totals']['subtotal_minor'] ?? 0) === 2500 && ($created['data']['totals']['total_minor'] ?? 0) === 2950, 'pedido ignora precio manipulado y recalcula server-side: '.json_encode([$status, $created], JSON_UNESCAPED_UNICODE));
    [$status, $payment] = call_api($apiPort, 'POST', '/api/v1/public/venues/casa-lima/orders/public-test-token/pay', ['payment_method'=>'yape','operation_code'=>'OP-123']); check_true($status === 201 && ($payment['data']['payment_status'] ?? '') === 'pending_verification', 'Yape queda pendiente de verificación');
    check_true(!str_contains(json_encode($menu, JSON_THROW_ON_ERROR), 'TEST_ONLY_NOT_SECRET'), 'service key no se expone en respuesta');
    echo "BFF contract tests PASSED".PHP_EOL;
} catch (Throwable $error) { fwrite(STDERR, $error->getMessage().PHP_EOL); exit(1); }
