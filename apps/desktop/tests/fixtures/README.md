# Test fixtures

`localhost.pem` and `localhost-key.pem` are a self-signed certificate and its key for `localhost`, made once with `openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj /CN=localhost` for the https readiness probe test in `services.test.ts`. They are test-only: nothing trusts them, and nothing outside the tests may use them.
