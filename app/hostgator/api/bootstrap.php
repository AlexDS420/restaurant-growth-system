<?php
declare(strict_types=1);

/** HostGator BFF: PHP 8.1+, Supabase REST. Service keys never reach the browser. */
final class ApiException extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message)
    { parent::__construct($message); }
}

function env_value(string $key, ?string $default = null): ?string
{
    static $loaded = false;
    if (!$loaded) {
        $candidates = array_filter([getenv('BFF_ENV_FILE') ?: null, dirname(__DIR__) . '/.env', dirname(__DIR__, 2) . '/private/.env', dirname(__DIR__, 2) . '/hostgator/.env']);
        $file = null;
        foreach ($candidates as $candidate) if (is_readable($candidate)) { $file = $candidate; break; }
        if ($file !== null) {
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
                [$name, $value] = explode('=', $line, 2);
                $name = trim($name); $value = trim($value, " \t\"'");
                if (getenv($name) === false) putenv($name . '=' . $value);
            }
        }
        $loaded = true;
    }
    $value = getenv($key);
    return $value === false || $value === '' ? $default : $value;
}

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    try { $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw new ApiException(400, 'INVALID_JSON', 'El cuerpo JSON no es válido.'); }
    if (!is_array($data)) throw new ApiException(400, 'INVALID_JSON', 'El cuerpo debe ser un objeto JSON.');
    return $data;
}

function respond(mixed $data, int $status = 200): never
{
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit;
}

function fail(ApiException $error): never
{
    http_response_code($error->status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    echo json_encode(['ok' => false, 'error' => ['code' => $error->errorCode, 'message' => $error->getMessage()]], JSON_UNESCAPED_UNICODE); exit;
}

function request_method(): string { return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'); }
function request_path(): string { return parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'; }
function require_string(array $body, string $key, int $max = 160): string
{
    $value = trim((string)($body[$key] ?? ''));
    if ($value === '' || mb_strlen($value) > $max) throw new ApiException(422, 'FIELD_INVALID', "El campo {$key} es obligatorio o excede su límite.");
    return $value;
}

final class SupabaseRest
{
    public function __construct(private readonly string $url, private readonly string $serviceKey) {}
    public static function fromEnv(): self
    {
        $url = rtrim((string)env_value('SUPABASE_URL'), '/'); $key = (string)env_value('SUPABASE_SERVICE_ROLE_KEY');
        if ($url === '' || $key === '') throw new ApiException(503, 'SUPABASE_NOT_CONFIGURED', 'Supabase no está configurado en el servidor.');
        return new self($url, $key);
    }
    public function query(string $table, array $params = []): array
    { return $this->request('GET', '/rest/v1/' . rawurlencode($table), $params); }
    public function insert(string $table, array $row): array
    { return $this->request('POST', '/rest/v1/' . rawurlencode($table), [], $row, ['Prefer: return=representation']); }
    public function update(string $table, array $filters, array $row): array
    { return $this->request('PATCH', '/rest/v1/' . rawurlencode($table), $filters, $row, ['Prefer: return=representation']); }
    public function signIn(string $email, string $password): array
    {
        $key = (string)env_value('SUPABASE_ANON_KEY', $this->serviceKey);
        return $this->rawRequest('POST', '/auth/v1/token?grant_type=password', [], ['email' => $email, 'password' => $password], ['apikey: ' . $key]);
    }
    public function authUser(string $accessToken): array
    { return $this->rawRequest('GET', '/auth/v1/user', [], null, ['apikey: ' . $this->serviceKey, 'Authorization: Bearer ' . $accessToken]); }
    private function rawRequest(string $method, string $path, array $params = [], ?array $body = null, array $extra = []): array
    {
        $url = $this->url . $path . ($params ? '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986) : '');
        $ch = curl_init($url); if ($ch === false) throw new ApiException(503, 'HTTP_UNAVAILABLE', 'No se pudo inicializar la conexión.');
        $headers = array_merge(['Accept: application/json'], $extra); if ($body !== null) $headers[] = 'Content-Type: application/json';
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15, CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR)]);
        $raw = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
        if ($raw === false || $err !== '') throw new ApiException(503, 'SUPABASE_UNAVAILABLE', 'No se pudo consultar autenticación.');
        $decoded = json_decode($raw, true);
        if ($status >= 400) throw new ApiException($status === 400 ? 401 : 502, $status === 400 ? 'INVALID_CREDENTIALS' : 'SUPABASE_AUTH_ERROR', 'No se pudo autenticar la cuenta.');
        return is_array($decoded) ? $decoded : [];
    }
    private function request(string $method, string $path, array $params = [], ?array $body = null, array $extra = []): array
    {
        $url = $this->url . $path . ($params ? '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986) : '');
        $ch = curl_init($url); if ($ch === false) throw new ApiException(503, 'HTTP_UNAVAILABLE', 'No se pudo inicializar la conexión.');
        $headers = array_merge(['apikey: ' . $this->serviceKey, 'Authorization: Bearer ' . $this->serviceKey, 'Accept: application/json'], $extra);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 15]);
        if ($body !== null) { $headers[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_HTTPHEADER, $headers); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR)); }
        $raw = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
        if ($raw === false || $err !== '') throw new ApiException(503, 'SUPABASE_UNAVAILABLE', 'No se pudo consultar la base de datos.');
        $decoded = json_decode($raw, true);
        if ($status >= 400) throw new ApiException(502, 'SUPABASE_ERROR', 'La base de datos rechazó la operación.');
        return is_array($decoded) ? $decoded : [];
    }
}

function session_user(SupabaseRest $db): ?array
{
    $token = $_COOKIE['ros_access_token'] ?? ''; if (!is_string($token) || strlen($token) < 20) return null;
    try { $auth = $db->authUser($token); } catch (ApiException) { return null; }
    $id = (string)($auth['id'] ?? ''); if (!preg_match('/^[0-9a-f-]{36}$/i', $id)) return null;
    $members = $db->query('organization_members', ['user_id' => 'eq.' . rawurlencode($id), 'active' => 'eq.true', 'select' => 'organization_id,role', 'limit' => '1']);
    if (!$members) return null;
    $venues = $db->query('venues', ['organization_id' => 'eq.' . rawurlencode((string)$members[0]['organization_id']), 'status' => 'eq.active', 'select' => 'id,name,slug,organization_id', 'limit' => '1']);
    return ['id' => $id, 'email' => $auth['email'] ?? '', 'name' => $auth['user_metadata']['name'] ?? ($auth['email'] ?? ''), 'role' => $members[0]['role'], 'venue_id' => $venues[0]['id'] ?? null, 'active' => true];
}
function require_session(SupabaseRest $db): array { $user = session_user($db); if (!$user) throw new ApiException(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.'); return $user; }
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return (string)$_SESSION['csrf'];
}
function require_csrf(): void
{
    $expected = $_SESSION['csrf'] ?? ''; $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($expected) || !is_string($provided) || $expected === '' || !hash_equals($expected, $provided)) throw new ApiException(419, 'CSRF_INVALID', 'Token CSRF inválido o ausente.');
}

session_name('ros_admin'); session_set_cookie_params(['httponly' => true, 'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'), 'samesite' => 'Lax', 'path' => '/']); session_start();
