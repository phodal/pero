FROM scratch
COPY pero-server /pero-server
COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/pero-server"]
