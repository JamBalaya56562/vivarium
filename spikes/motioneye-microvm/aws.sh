#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
state="$here/build/aws.env"
region=ap-northeast-1
name=vivarium-spike-motioneye
role=vivarium-spike-motioneye-build
log_group=/aws/lambda-microvms/$name
proxy=vivarium-spike-motioneye-proxy
proxy_log_group=/aws/lambda/$proxy
base_image=arn:aws:lambda:$region:aws:microvm-image:al2023-1
connector=arn:aws:lambda:$region:aws:network-connector:aws-network-connector
hook=/aws/lambda-microvms/runtime/v1

aws() {
  MSYS_NO_PATHCONV=1 "${DOCKER:-/c/Program Files/Docker/Docker/resources/bin/docker.exe}" run --rm -i \
    -v "$(cygpath -w "$HOME/.aws"):/root/.aws" \
    -v "$(cygpath -w "$here/build"):/build" \
    -e AWS_REGION="$region" -e AWS_PAGER= \
    amazon/aws-cli:2.37.12 "$@"
}

save() {
  touch "$state"
  grep -v "^$1=" "$state" > "$state.tmp" || true
  echo "$1=$2" >> "$state.tmp"
  mv "$state.tmp" "$state"
}

load() {
  # shellcheck source=/dev/null
  [ -f "$state" ] && . "$state"
  return 0
}

do_setup() {
  local account bucket
  account=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
  bucket=vivarium-spike-$account-$region
  aws s3api create-bucket --bucket "$bucket" \
    --create-bucket-configuration LocationConstraint="$region" > /dev/null
  aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws logs create-log-group --log-group-name "$log_group"
  aws logs put-retention-policy --log-group-name "$log_group" --retention-in-days 7
  aws iam create-role --role-name "$role" --query Role.Arn --output text \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "lambda.amazonaws.com"},
        "Action": ["sts:AssumeRole", "sts:TagSession"]
      }]
    }'
  aws iam put-role-policy --role-name "$role" --policy-name build --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\", \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::$bucket/*\"},
      {\"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogStream\", \"logs:PutLogEvents\"],
       \"Resource\": \"arn:aws:logs:$region:$account:log-group:$log_group:*\"}
    ]
  }"
  save ACCOUNT "$account"
  save BUCKET "$bucket"
  save ROLE_ARN "arn:aws:iam::$account:role/$role"
}

do_image() {
  load
  local commit=${1:?usage: aws.sh image <commit>}
  [ -f "$here/build/$commit.zip" ] || { echo "run pack.sh first" >&2; exit 1; }
  aws s3 cp "/build/$commit.zip" "s3://$BUCKET/$commit.zip"
  aws lambda-microvms create-microvm-image --cli-input-json "{
    \"name\": \"$name\",
    \"description\": \"motionEye $commit with fake cameras (vivarium spike)\",
    \"baseImageArn\": \"$base_image\",
    \"buildRoleArn\": \"$ROLE_ARN\",
    \"codeArtifact\": {\"uri\": \"s3://$BUCKET/$commit.zip\"},
    \"logging\": {\"cloudWatch\": {\"logGroup\": \"$log_group\"}},
    \"egressNetworkConnectors\": [\"$connector:INTERNET_EGRESS\"],
    \"cpuConfigurations\": [{\"architecture\": \"ARM_64\"}],
    \"resources\": [{\"minimumMemoryInMiB\": 1024}],
    \"additionalOsCapabilities\": [\"ALL\"],
    \"hooks\": {
      \"port\": 9000,
      \"microvmImageHooks\": {
        \"ready\": \"ENABLED\", \"readyTimeoutInSeconds\": 600,
        \"validate\": \"ENABLED\", \"validateTimeoutInSeconds\": 300
      },
      \"microvmHooks\": {
        \"run\": \"DISABLED\", \"resume\": \"DISABLED\",
        \"suspend\": \"DISABLED\", \"terminate\": \"DISABLED\"
      }
    },
    \"tags\": {\"Project\": \"vivarium\", \"Purpose\": \"spike\"}
  }"
}

do_status() {
  aws lambda-microvms get-microvm-image --image-identifier "$name"
}

do_run() {
  local id
  id=$(aws lambda-microvms run-microvm --image-identifier "$name" \
    --ingress-network-connectors "$connector:ALL_INGRESS" \
    --idle-policy autoResumeEnabled=true,maxIdleDurationSeconds=300,suspendedDurationSeconds=1800 \
    --maximum-duration-in-seconds 3600 \
    --query microvmId --output text | tr -d '\r')
  save MICROVM "$id"
  echo "$id"
}

do_vm() {
  load
  aws lambda-microvms get-microvm --microvm-identifier "$MICROVM"
}

do_token() {
  load
  local endpoint auth
  endpoint=$(aws lambda-microvms get-microvm --microvm-identifier "$MICROVM" \
    --query endpoint --output text | tr -d '\r')
  auth=$(aws lambda-microvms create-microvm-auth-token --microvm-identifier "$MICROVM" \
    --expiration-in-minutes 60 --allowed-ports '[{"port": 8765}, {"port": 9000}]' \
    --query 'authToken."X-aws-proxy-auth"' --output text | tr -d '\r')
  save ENDPOINT "$endpoint"
  save TOKEN "$auth"
  echo "token saved for $endpoint"
}

do_check() {
  load
  local jar shots
  jar=$(mktemp)
  shots="$here/build/shots"
  mkdir -p "$shots"
  me() { curl -sS -H "X-aws-proxy-auth: $TOKEN" -H "X-aws-proxy-port: 8765" -b "$jar" -c "$jar" "$@"; }
  curl -sS -o /dev/null -w "ready %{http_code}\n" \
    -H "X-aws-proxy-auth: $TOKEN" -H "X-aws-proxy-port: 9000" "https://$ENDPOINT$hook/ready"
  me -o /dev/null -w "index %{http_code}\n" "https://$ENDPOINT/"
  me -H "Content-Type: application/json" -d '{"username":"admin","password":""}' \
    -w "\nlogin %{http_code}\n" "https://$ENDPOINT/login"
  for camera in 1 2 3 4; do
    me -o "$shots/cam$camera-$(date -u +%H%M%S).jpg" \
      -w "camera $camera %{http_code} %{content_type} %{size_download} bytes %{time_total}s\n" \
      "https://$ENDPOINT/picture/$camera/current/"
  done
  rm -f "$jar"
}

do_suspend() {
  load
  aws lambda-microvms suspend-microvm --microvm-identifier "$MICROVM"
}

do_terminate() {
  load
  aws lambda-microvms terminate-microvm --microvm-identifier "$MICROVM"
}

do_proxy() {
  load
  local image_arn url
  image_arn=$(aws lambda-microvms get-microvm-image --image-identifier "$name"     --query imageArn --output text | tr -d '')
  python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1], "w").write(sys.argv[2], "index.mjs")'     "$here/build/proxy.zip" "$here/proxy/index.mjs"
  if [ -z "${PROXY_ROLE_ARN:-}" ]; then
    aws logs create-log-group --log-group-name "$proxy_log_group"
    aws logs put-retention-policy --log-group-name "$proxy_log_group" --retention-in-days 7
    aws iam create-role --role-name "$proxy" --query Role.Arn --output text       --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Principal": {"Service": "lambda.amazonaws.com"},
          "Action": "sts:AssumeRole"
        }]
      }'
    save PROXY_ROLE_ARN "arn:aws:iam::$ACCOUNT:role/$proxy"
    load
  fi
  aws iam put-role-policy --role-name "$proxy" --policy-name proxy --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\",
       \"Action\": [\"lambda:RunMicrovm\", \"lambda:GetMicrovm\", \"lambda:CreateMicrovmAuthToken\"],
       \"Resource\": \"$image_arn\"},
      {\"Effect\": \"Allow\", \"Action\": \"lambda:ListMicrovms\", \"Resource\": \"*\"},
      {\"Effect\": \"Allow\", \"Action\": \"lambda:PassNetworkConnector\", \"Resource\": \"*\"},
      {\"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogStream\", \"logs:PutLogEvents\"],
       \"Resource\": \"arn:aws:logs:$region:$ACCOUNT:log-group:$proxy_log_group:*\"}
    ]
  }"
  if [ -z "${ACCESS_KEY:-}" ]; then
    save ACCESS_KEY "$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
    load
  fi
  local environment="Variables={IMAGE_ARN=$image_arn,INGRESS_CONNECTOR=$connector:ALL_INGRESS,ACCESS_KEY=$ACCESS_KEY}"
  if [ -z "${PROXY_URL:-}" ]; then
    sleep 10
    aws lambda create-function --function-name "$proxy" --runtime nodejs24.x       --architectures arm64 --handler index.handler --role "$PROXY_ROLE_ARN"       --zip-file fileb:///build/proxy.zip --memory-size 256 --timeout 60       --logging-config "LogFormat=Text,LogGroup=$proxy_log_group"       --environment "$environment" > /dev/null
    aws lambda wait function-active-v2 --function-name "$proxy"
    url=$(aws lambda create-function-url-config --function-name "$proxy"       --auth-type NONE --invoke-mode RESPONSE_STREAM --query FunctionUrl --output text | tr -d '')
    aws lambda add-permission --function-name "$proxy" --statement-id public-function-url       --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE > /dev/null
    aws lambda add-permission --function-name "$proxy" --statement-id public-function-url-invoke       --action lambda:InvokeFunction --principal '*' --invoked-via-function-url > /dev/null
    save PROXY_URL "$url"
  else
    aws lambda update-function-code --function-name "$proxy"       --zip-file fileb:///build/proxy.zip > /dev/null
    aws lambda wait function-updated-v2 --function-name "$proxy"
    aws lambda update-function-configuration --function-name "$proxy"       --environment "$environment" > /dev/null
  fi
  do_link
}

do_link() {
  load
  echo "${PROXY_URL}?vivarium-key=$ACCESS_KEY"
}

do_proxy_logs() {
  aws logs tail "$proxy_log_group" --since "${1:-1h}"
}

do_cleanup() {
  load
  aws lambda delete-function --function-name "$proxy" || true
  aws iam delete-role-policy --role-name "$proxy" --policy-name proxy || true
  aws iam delete-role --role-name "$proxy" || true
  aws logs delete-log-group --log-group-name "$proxy_log_group" || true
  aws lambda-microvms delete-microvm-image --image-identifier "$name" || true
  aws s3 rm "s3://$BUCKET" --recursive || true
  aws s3api delete-bucket --bucket "$BUCKET" || true
  aws iam delete-role-policy --role-name "$role" --policy-name build || true
  aws iam delete-role --role-name "$role" || true
  aws logs delete-log-group --log-group-name "$log_group" || true
}

do_logs() {
  aws logs tail "$log_group" --since "${1:-1h}"
}

cmd=${1:-}
shift || true
case "$cmd" in
  setup | image | status | run | vm | token | check | suspend | terminate | proxy | link | cleanup | logs) "do_$cmd" "$@" ;;
  proxy-logs) do_proxy_logs "$@" ;;
  *)
    echo "usage: aws.sh setup | image <commit> | status | logs [since] | run | vm | token | check | suspend | terminate | proxy | link | proxy-logs [since] | cleanup" >&2
    exit 2
    ;;
esac
