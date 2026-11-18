<?php

spl_autoload_register(function (string $class): void {
    $root = dirname(__DIR__, 3);
    if (str_starts_with($class, 'Biti\\Sdk\\')) {
        $file = $root . '/sdk/php/src/' . substr($class, strlen('Biti\\Sdk\\')) . '.php';
    } elseif (str_starts_with($class, 'Daryeel\\')) {
        $name = substr($class, strlen('Daryeel\\'));
        $file = __DIR__ . '/' . str_replace('\\', '/', $name) . '.php';
    } else {
        return;
    }
    if (is_file($file)) {
        require $file;
    }
});
