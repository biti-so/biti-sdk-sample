<?php

namespace Biti\Sdk;

class BitiError extends \RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0, public readonly ?string $errorCode = null, public readonly mixed $data = null)
    {
        parent::__construct($message, $status);
    }
}
