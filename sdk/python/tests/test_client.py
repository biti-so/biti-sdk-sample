import hashlib
import hmac
import os
import sys
import unittest
from unittest import mock

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from biti_partner import ENDPOINTS, BitiClient, BitiError  # noqa: E402

SECRET = "s3cret"


def sign(body, secret=SECRET):
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def reply(status, payload):
    response = mock.Mock(status_code=status)
    response.json.return_value = payload
    return response


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.client = BitiClient("http://biti/", "cid", SECRET)

    def test_headers_and_token_only_when_given(self):
        with mock.patch("requests.post", return_value=reply(200, {"success": True, "data": {"ok": 1}})) as post:
            self.assertEqual(self.client.create_order({"amount": 5}), {"ok": 1})
            self.client.connected_wallet(token="tok")
        first, second = post.call_args_list
        self.assertEqual(first.args[0], "http://biti/partner/v1/create-order")
        self.assertEqual(first.kwargs["json"], {"amount": 5})
        self.assertEqual(first.kwargs["headers"]["X-Biti-Client-Id"], "cid")
        self.assertEqual(first.kwargs["headers"]["X-Biti-Client-Secret"], SECRET)
        self.assertNotIn("X-Biti-Token", first.kwargs["headers"])
        self.assertEqual(second.kwargs["headers"]["X-Biti-Token"], "tok")

    def test_nested_message_envelope(self):
        with mock.patch("requests.post", return_value=reply(200, {"message": {"success": True, "data": {"id": 7}}})):
            self.assertEqual(self.client.get_order_status(), {"id": 7})

    def test_error_status_and_code(self):
        payload = {"success": False, "message": "Nope", "data": {"code": "needs_linking"}}
        with mock.patch("requests.post", return_value=reply(409, payload)):
            with self.assertRaises(BitiError) as caught:
                self.client.create_topup({})
        self.assertEqual((caught.exception.message, caught.exception.status, caught.exception.code), ("Nope", 409, "needs_linking"))

    def test_network_error_is_502(self):
        with mock.patch("requests.post", side_effect=requests.ConnectionError("down")):
            with self.assertRaises(BitiError) as caught:
                self.client.create_order({})
        self.assertEqual(caught.exception.status, 502)

    def test_trace_redacts(self):
        traces = []
        client = BitiClient("http://biti", "cid", SECRET, on_trace=traces.append)
        with mock.patch("requests.post", return_value=reply(200, {"success": True, "data": {"access_token": "abc"}})):
            client.exchange_login_code({"code": "123"}, token="t")
        self.assertEqual(traces[0]["request"]["code"], "•••")
        self.assertEqual(traces[0]["response"]["data"]["access_token"], "•••")
        self.assertTrue(traces[0]["with_token"])

    def test_every_endpoint_has_a_method(self):
        self.assertEqual(len(ENDPOINTS), 33)
        for method, _endpoint, _token in ENDPOINTS:
            self.assertTrue(callable(getattr(self.client, method)), method)


class SignatureTest(unittest.TestCase):
    body = '{"event":"x"}'
    now = 1_700_000_000

    def headers(self, **extra):
        return {"X-Biti-Signature": sign(self.body), "X-Biti-Timestamp": str(self.now), **extra}

    def test_valid(self):
        self.assertTrue(BitiClient.verify_webhook(self.body, self.headers(), SECRET, now=self.now))
        self.assertTrue(BitiClient.verify_lookup(self.body.encode(), self.headers(), SECRET, now=self.now))

    def test_case_insensitive_headers(self):
        headers = {"x-biti-signature": sign(self.body), "X-BITI-TIMESTAMP": str(self.now)}
        self.assertTrue(BitiClient.verify_webhook(self.body, headers, SECRET, now=self.now))

    def test_invalid(self):
        self.assertFalse(BitiClient.verify_webhook(self.body, self.headers(), "other", now=self.now))
        self.assertFalse(BitiClient.verify_webhook(self.body + " ", self.headers(), SECRET, now=self.now))
        self.assertFalse(BitiClient.verify_webhook(self.body, {}, SECRET, now=self.now))

    def test_stale_timestamp(self):
        self.assertFalse(BitiClient.verify_webhook(self.body, self.headers(), SECRET, now=self.now + 301))
        self.assertTrue(BitiClient.verify_webhook(self.body, self.headers(), SECRET, now=self.now + 301, tolerance=600))


if __name__ == "__main__":
    unittest.main()
