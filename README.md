# dashwithmash.com

## deploy notes

Terminate SSL at nginx. WS configuration as follows.

```
location /ws {
	rewrite /ws(.*) /  break;
	proxy_pass <local addr>;
	proxy_redirect     off;
	proxy_set_header   Host $host;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_connect_timeout 7d;
	proxy_send_timeout 7d;
	proxy_read_timeout 7d;
}
```

