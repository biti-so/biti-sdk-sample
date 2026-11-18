<?php

use Daryeel\App;
use Daryeel\Config;
use Daryeel\Request;
use Daryeel\Response;

require dirname(__DIR__) . '/src/bootstrap.php';

ini_set('display_errors', '0');

$config = new Config(dirname(__DIR__, 3));
$missing = $config->missing();
if ($missing) {
    Response::error('Missing ' . implode(', ', $missing) . ' in .env. Copy .env.example to .env and fill it in.', 500)->send();
    return;
}

$response = (new App($config))->handle(Request::fromGlobals());
($response ?? Response::error('Not found', 404))->send();
