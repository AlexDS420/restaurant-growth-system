<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// Expiration is intentionally dry-run until the business defines the SLA.
fwrite(STDOUT, gmdate('c') . " expire_pending dry-run: configure SLA before enabling mutations\n");
