# Wordpress lightning domain integration

Make sure to replace `lawallet.example.com` with your lawallet domain.

You need to add the following script to you `functions.php` file.

```php
define('REMOTE_DOMAIN', 'https://lawallet.example.com'); // 👈 change this

add_action('init', function () {
  add_rewrite_rule('^\.well-known/lnurlp/([^/?]+)$', 'index.php?lnurlp_user=$matches[1]', 'top');
});

add_filter('query_vars', function ($vars) {
  $vars[] = 'lnurlp_user';
  return $vars;
});

add_action('template_redirect', function () {
  $user = get_query_var('lnurlp_user');
  if (!$user) return;

  $url = rtrim(REMOTE_DOMAIN, '/') . '/.well-known/lnurlp/' . rawurlencode($user);

  if (!empty($_SERVER['QUERY_STRING'])) {
    $url .= (strpos($url, '?') === false ? '?' : '&') . $_SERVER['QUERY_STRING'];
  }

  $resp = wp_remote_get($url, ['timeout' => 8]);

  if (is_wp_error($resp)) {
    status_header(502);
    wp_die('Upstream fetch failed');
  }

  $status  = wp_remote_retrieve_response_code($resp) ?: 200;
  $body    = wp_remote_retrieve_body($resp);
  $headers = wp_remote_retrieve_headers($resp);

  if (!headers_sent()) {
    if (!empty($headers['content-type'])) {
      header('Content-Type: ' . $headers['content-type']);
    } else {
      header('Content-Type: application/json; charset=utf-8');
    }
    foreach (['cache-control','expires','etag','last-modified'] as $h) {
      if (!empty($headers[$h])) {
        header($h . ': ' . $headers[$h], true);
      }
    }
    status_header($status);
  }

  echo $body;
  exit;
});
```
