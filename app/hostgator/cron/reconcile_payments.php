<?php
declare(strict_types=1);
// cPanel cron entrypoint. CLI-only; never expose this file under public_html.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/api/bootstrap.php';
try {
    $db = SupabaseRest::fromEnv();
    $rows = $db->query('payments', ['method'=>'in.(yape,plin)', 'status'=>'eq.verifying', 'select'=>'id,venue_id,operation_code,created_at', 'order'=>'created_at.asc', 'limit'=>'200']);
    fwrite(STDOUT, sprintf("%s pending_yape_plin=%d\n", gmdate('c'), count($rows)));
} catch (Throwable $e) { fwrite(STDERR, "reconcile failed\n"); exit(1); }
