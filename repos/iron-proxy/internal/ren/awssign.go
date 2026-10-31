package ren

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

var signatureHeaders = []string{"Authorization", "X-Amz-Date", "X-Amz-Security-Token", "X-Amz-Content-Sha256"}

func sigV4Scope(authorization string) (region, service string, err error) {
	rest, ok := strings.CutPrefix(authorization, "AWS4-HMAC-SHA256 ")
	if !ok {
		return "", "", errors.New("awsSign: the request has no SigV4 Authorization header")
	}
	for _, part := range strings.Split(rest, ",") {
		credential, ok := strings.CutPrefix(strings.TrimSpace(part), "Credential=")
		if !ok {
			continue
		}
		parts := strings.Split(credential, "/")
		if len(parts) != 5 || parts[2] == "" || parts[3] == "" || parts[4] != "aws4_request" {
			return "", "", errors.New("awsSign: malformed SigV4 credential scope")
		}
		return parts[2], parts[3], nil
	}
	return "", "", errors.New("awsSign: the SigV4 Authorization header has no Credential")
}

func awsSign(req *http.Request, op Op, now time.Time) error {
	region, service, err := sigV4Scope(req.Header.Get("Authorization"))
	if err != nil {
		return err
	}
	payloadHash := req.Header.Get("X-Amz-Content-Sha256")
	if payloadHash == "" {
		payloadHash = "UNSIGNED-PAYLOAD"
	}
	if strings.HasPrefix(payloadHash, "STREAMING-AWS4-") {
		return errors.New("awsSign: the body's chunks are signed with the removed signature")
	}
	signed := req.Clone(req.Context())
	signed.Header = http.Header{}
	for name, values := range req.Header {
		if strings.HasPrefix(http.CanonicalHeaderKey(name), "X-Amz-") {
			signed.Header[name] = values
		}
	}
	for _, name := range signatureHeaders {
		signed.Header.Del(name)
	}
	signed.Header.Set("X-Amz-Content-Sha256", payloadHash)
	credentials := aws.Credentials{AccessKeyID: op.AccessKeyID, SecretAccessKey: op.SecretAccessKey, SessionToken: op.SessionToken}
	if err := v4.NewSigner().SignHTTP(req.Context(), credentials, signed, payloadHash, service, region, now, func(options *v4.SignerOptions) {
		options.DisableURIPathEscaping = service == "s3"
	}); err != nil {
		return errors.New("awsSign: signing failed")
	}
	for _, name := range signatureHeaders {
		req.Header.Del(name)
		if value := signed.Header.Get(name); value != "" {
			req.Header.Set(name, value)
		}
	}
	return nil
}
