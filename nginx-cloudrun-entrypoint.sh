#!/bin/sh
# Substitute $API_URL into the nginx config template at container startup
envsubst '${API_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf
echo "[entrypoint] nginx config written with API_URL=${API_URL}"
