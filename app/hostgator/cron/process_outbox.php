<?php
declare(strict_types=1);

// cPanel Cron only. Never expose this file through a web route.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/api/bootstrap.php';

const MAX_BATCH = 25;
const MAX_ATTEMPTS = 8;

function cli_log(string $message): void { fwrite(STDOUT, '[' . gmdate('c') . '] ' . $message . PHP_EOL); }

function send_outbox_webhook(array $event): void
{
    $url = (string)env_value('OUTBOX_WEBHOOK_URL', '');
    if ($url === '') throw new RuntimeException('OUTBOX_WEBHOOK_URL no está configurado');
    if (!filter_var($url, FILTER_VALIDATE_URL) || !str_starts_with(strtolower($url), 'https://')) throw new RuntimeException('OUTBOX_WEBHOOK_URL debe ser HTTPS');
    $payload = json_encode(['event_id'=>$event['id'], 'event_type'=>$event['event_type'], 'entity_type'=>$event['entity_type'], 'entity_id'=>$event['entity_id'], 'venue_id'=>$event['venue_id'], 'payload'=>$event['payload']], JSON_THROW_ON_ERROR);
    $ch = curl_init($url); if ($ch === false) throw new RuntimeException('No se pudo inicializar webhook');
    curl_setopt_array($ch, [CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>$payload, CURLOPT_RETURNTRANSFER=>true, CURLOPT_HTTPHEADER=>['Content-Type: application/json', 'X-Idempotency-Key: '.$event['id']], CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>15]);
    $response = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $error = curl_error($ch);
    if ($response === false || $error !== '' || $status < 200 || $status >= 300) throw new RuntimeException('Webhook falló con HTTP ' . $status);
}

try {
    $db = SupabaseRest::fromEnv(); $now = gmdate('c');
    // Recupera locks abandonados por un proceso terminado durante un máximo de 10 minutos.
    $db->update('outbox_events', ['status'=>'eq.processing', 'locked_at'=>'lt.'.gmdate('c', time() - 600)], ['status'=>'failed', 'next_attempt_at'=>$now, 'last_error'=>'Lock recuperado por cron', 'updated_at'=>$now]);
    $events = $db->query('outbox_events', ['status'=>'in.(pending,failed)', 'next_attempt_at'=>'lte.'.$now, 'order'=>'created_at.asc', 'limit'=>(string)MAX_BATCH, 'select'=>'*']);
    $sent = 0; $failed = 0;
    foreach ($events as $candidate) {
        // El filtro status=pending hace que solo el primer cron concurrente pueda reclamarlo.
        $claimed = $db->update('outbox_events', ['id'=>'eq.'.rawurlencode((string)$candidate['id']), 'status'=>'in.(pending,failed)'], ['status'=>'processing', 'attempts'=>(int)$candidate['attempts'] + 1, 'locked_at'=>$now, 'updated_at'=>$now]);
        if (!$claimed) continue;
        $event = $claimed[0] ?? $candidate;
        try {
            send_outbox_webhook($event);
            $db->update('outbox_events', ['id'=>'eq.'.rawurlencode((string)$event['id']), 'status'=>'eq.processing'], ['status'=>'sent', 'sent_at'=>gmdate('c'), 'last_error'=>null, 'updated_at'=>gmdate('c')]);
            $sent++;
        } catch (Throwable $error) {
            $attempts = (int)($event['attempts'] ?? 1); $terminal = $attempts >= MAX_ATTEMPTS; $delay = min(3600, 15 * (2 ** min($attempts, 8))); $next = gmdate('c', time() + $delay);
            $db->update('outbox_events', ['id'=>'eq.'.rawurlencode((string)$event['id']), 'status'=>'eq.processing'], ['status'=>$terminal ? 'dead_letter' : 'failed', 'next_attempt_at'=>$terminal ? gmdate('c') : $next, 'last_error'=>substr($error->getMessage(), 0, 500), 'updated_at'=>gmdate('c')]);
            $failed++; cli_log('evento fallido ' . (string)$event['id'] . ($terminal ? ' [dead_letter]' : ' [reintento]'));
        }
    }
    cli_log('outbox completado: enviados='.$sent.' fallidos='.$failed.' seleccionados='.count($events));
    exit($failed > 0 ? 1 : 0);
} catch (Throwable $error) {
    cli_log('error de worker: '.$error->getMessage()); exit(1);
}
