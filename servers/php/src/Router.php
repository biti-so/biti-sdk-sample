<?php

namespace Daryeel;

final class Router
{
    private array $routes = [];

    public static function pattern(string $route): string
    {
        return '#^' . preg_replace('/:(\w+)/', '(?P<$1>[^/]+)', $route) . '$#';
    }

    public function add(string $method, string $route, callable|array $handler, bool $needsUser = false): void
    {
        $this->routes[] = [$method, self::pattern($route), $handler, $needsUser];
    }

    /** @return array{0: callable, 1: bool, 2: array}|null */
    public function match(string $method, string $path): ?array
    {
        foreach ($this->routes as [$routeMethod, $pattern, $handler, $needsUser]) {
            if ($routeMethod === $method && preg_match($pattern, $path, $found)) {
                $params = array_filter($found, 'is_string', ARRAY_FILTER_USE_KEY);
                return [$handler, $needsUser, array_map('rawurldecode', $params)];
            }
        }
        return null;
    }
}
