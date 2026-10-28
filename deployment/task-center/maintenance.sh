#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/nginx/sbin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
case ${1:-} in
    backup)
        folder=/var/lib/openpero/backups
        temporary=$(mktemp "$folder/.backup.XXXXXX")
        trap 'rm -f "$temporary"' EXIT
        docker exec openpero-postgres pg_dump -U pero -d pero -Fc > "$temporary"
        mv "$temporary" "$folder/daily-$(date -u +%Y%m%d).dump"
        find "$folder" -name 'daily-*.dump' -mtime +7 -delete
        ;;
    renew)
        /root/certenv/bin/certbot renew --cert-name app.openpero.com \
            --non-interactive --no-random-sleep-on-renew --max-log-backups 3 \
            --deploy-hook '/usr/local/nginx/sbin/nginx -t && /usr/local/nginx/sbin/nginx -s reload'
        ;;
    *) echo 'usage: maintenance.sh {backup|renew}' >&2; exit 2 ;;
esac
