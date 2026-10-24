FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /iron-proxy ./cmd/iron-proxy

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /iron-proxy /usr/local/bin/iron-proxy
ENTRYPOINT ["iron-proxy"]
