from dotdot.worker import redis_url


def test_socket_timeout_longer_than_blocking_wait():
    assert redis_url("redis://redis:6379") == "redis://redis:6379?socket_timeout=30"
    assert redis_url("redis://r:6379/0?ssl_cert_reqs=none") == "redis://r:6379/0?ssl_cert_reqs=none&socket_timeout=30"
    assert redis_url("redis://r?socket_timeout=60") == "redis://r?socket_timeout=60"
