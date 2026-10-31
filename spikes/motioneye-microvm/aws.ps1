#Requires -Version 7
param(
    [Parameter(Position = 0)] [string] $Command,
    [Parameter(Position = 1)] [string] $Argument
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'

$Docker = $env:VIVARIUM_DOCKER ?? 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$Region = 'ap-northeast-1'
$Name = 'vivarium-spike-motioneye'
$BuildRole = 'vivarium-spike-motioneye-build'
$Proxy = 'vivarium-spike-motioneye-proxy'
$LogGroup = "/aws/lambda-microvms/$Name"
$ProxyLogGroup = "/aws/lambda/$Proxy"
$BaseImage = "arn:aws:lambda:${Region}:aws:microvm-image:al2023-1"
$Connector = "arn:aws:lambda:${Region}:aws:network-connector:aws-network-connector"
$Hook = '/aws/lambda-microvms/runtime/v1'
$Build = Join-Path $PSScriptRoot 'build'
$StateFile = Join-Path $Build 'aws.json'

New-Item -ItemType Directory -Force $Build | Out-Null

function Read-State {
    if (Test-Path $StateFile) { return Get-Content $StateFile -Raw | ConvertFrom-Json -AsHashtable }
    $state = @{}
    $legacy = Join-Path $Build 'aws.env'
    if (Test-Path $legacy) {
        foreach ($line in Get-Content $legacy) {
            $key, $value = $line -split '=', 2
            if ($key) { $state[$key] = $value }
        }
    }
    return $state
}

function Save-State([string] $Key, [string] $Value) {
    $state = Read-State
    $state[$Key] = $Value
    $state | ConvertTo-Json | Set-Content $StateFile
}

function Need([string] $Key) {
    $value = (Read-State)[$Key]
    if (-not $value) { throw "$Key is not known yet; run the earlier step first" }
    return $value
}

function Write-Input([string] $FileName, $Object) {
    $Object | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Build $FileName)
    return "file:///build/$FileName"
}

function Invoke-Aws {
    $output = & $Docker run --rm -i `
        -v "$HOME\.aws:/root/.aws" -v "${Build}:/build" `
        -e "AWS_REGION=$Region" -e 'AWS_PAGER=' -e 'AWS_DEFAULT_OUTPUT=json' `
        amazon/aws-cli:2.37.12 @args
    if ($LASTEXITCODE) { throw "aws $($args[0..1] -join ' ') failed with exit code $LASTEXITCODE" }
    $text = ($output | Out-String).Trim()
    if ($text -and $text[0] -in '{', '[') { return $text | ConvertFrom-Json }
    return $text
}

function Image-Arn {
    return "arn:aws:lambda:${Region}:$(Need ACCOUNT):microvm-image:$Name"
}

function Step-Setup {
    $account = (Invoke-Aws sts get-caller-identity).Account
    $bucket = "vivarium-spike-$account-$Region"
    Invoke-Aws s3api create-bucket --bucket $bucket --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
    Invoke-Aws s3api put-public-access-block --bucket $bucket --public-access-block-configuration `
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' | Out-Null
    Invoke-Aws logs create-log-group --log-group-name $LogGroup | Out-Null
    Invoke-Aws logs put-retention-policy --log-group-name $LogGroup --retention-in-days 7 | Out-Null
    $trust = Write-Input 'trust-build.json' @{
        Version   = '2012-10-17'
        Statement = @(@{ Effect = 'Allow'; Principal = @{ Service = 'lambda.amazonaws.com' }; Action = @('sts:AssumeRole', 'sts:TagSession') })
    }
    Invoke-Aws iam create-role --role-name $BuildRole --assume-role-policy-document $trust | Out-Null
    $policy = Write-Input 'policy-build.json' @{
        Version   = '2012-10-17'
        Statement = @(
            @{ Effect = 'Allow'; Action = 's3:GetObject'; Resource = "arn:aws:s3:::$bucket/*" }
            @{ Effect = 'Allow'; Action = @('logs:CreateLogStream', 'logs:PutLogEvents'); Resource = "arn:aws:logs:${Region}:${account}:log-group:${LogGroup}:*" }
        )
    }
    Invoke-Aws iam put-role-policy --role-name $BuildRole --policy-name build --policy-document $policy | Out-Null
    Save-State ACCOUNT $account
    Save-State BUCKET $bucket
    Save-State ROLE_ARN "arn:aws:iam::${account}:role/$BuildRole"
    Write-Host "OK: bucket $bucket, log group $LogGroup, role $BuildRole"
}

function Step-Image([string] $Commit) {
    if (-not $Commit) { throw 'usage: aws.ps1 image <commit>' }
    if (-not (Test-Path (Join-Path $Build "$Commit.zip"))) { throw "build\$Commit.zip is missing; run pack.ps1 first" }
    $bucket = Need BUCKET
    Invoke-Aws s3 cp "/build/$Commit.zip" "s3://$bucket/$Commit.zip" | Out-Null
    $spec = @{
        description                = "motionEye $Commit with fake cameras (vivarium spike)"
        baseImageArn               = $BaseImage
        buildRoleArn               = Need ROLE_ARN
        codeArtifact               = @{ uri = "s3://$bucket/$Commit.zip" }
        logging                    = @{ cloudWatch = @{ logGroup = $LogGroup } }
        egressNetworkConnectors    = @("${Connector}:INTERNET_EGRESS")
        cpuConfigurations          = @(@{ architecture = 'ARM_64' })
        resources                  = @(@{ minimumMemoryInMiB = 1024 })
        additionalOsCapabilities   = @('ALL')
        hooks                      = @{
            port              = 9000
            microvmImageHooks = @{ ready = 'ENABLED'; readyTimeoutInSeconds = 600; validate = 'ENABLED'; validateTimeoutInSeconds = 300 }
            microvmHooks      = @{ run = 'DISABLED'; resume = 'DISABLED'; suspend = 'DISABLED'; terminate = 'DISABLED' }
        }
    }
    $existing = $null
    try { $existing = Invoke-Aws lambda-microvms get-microvm-image --image-identifier (Image-Arn) } catch { }
    if ($existing) {
        $request = Write-Input 'update-image.json' ($spec + @{ imageIdentifier = Image-Arn })
        $image = Invoke-Aws lambda-microvms update-microvm-image --cli-input-json $request
        Write-Host "OK: new image version build started (was $($existing.state)), state $($image.state)"
    } else {
        $request = Write-Input 'create-image.json' ($spec + @{ name = $Name; tags = @{ Project = 'vivarium'; Purpose = 'spike' } })
        $image = Invoke-Aws lambda-microvms create-microvm-image --cli-input-json $request
        Write-Host "OK: image build started, state $($image.state)"
    }
}

function Step-Status {
    $image = Invoke-Aws lambda-microvms get-microvm-image --image-identifier (Image-Arn)
    $image | ConvertTo-Json -Depth 10
    Write-Host "STATE: $($image.state)"
}

function Step-Version([string] $Version) {
    $image = Invoke-Aws lambda-microvms get-microvm-image --image-identifier (Image-Arn)
    $Version = $Version ? $Version : ($image.latestFailedImageVersion ?? $image.latestImageVersion ?? '1.0')
    $answer = Invoke-Aws lambda-microvms get-microvm-image-version --image-identifier (Image-Arn) --image-version $Version
    $answer | ConvertTo-Json -Depth 10
    Write-Host "VERSION $Version STATE: $($answer.state) $($answer.stateReason)"
}

function Step-Run {
    $request = Write-Input 'run-microvm.json' @{
        imageIdentifier          = Image-Arn
        ingressNetworkConnectors = @("${Connector}:ALL_INGRESS")
        idlePolicy               = @{ autoResumeEnabled = $true; maxIdleDurationSeconds = 300; suspendedDurationSeconds = 1800 }
        maximumDurationInSeconds = 3600
    }
    $microvm = Invoke-Aws lambda-microvms run-microvm --cli-input-json $request
    Save-State MICROVM $microvm.microvmId
    Write-Host "OK: MicroVM $($microvm.microvmId), state $($microvm.state)"
}

function Step-Vm {
    $microvm = Invoke-Aws lambda-microvms get-microvm --microvm-identifier (Need MICROVM)
    $microvm | ConvertTo-Json -Depth 10
    Write-Host "STATE: $($microvm.state)"
}

function Step-Token {
    $id = Need MICROVM
    $microvm = Invoke-Aws lambda-microvms get-microvm --microvm-identifier $id
    $request = Write-Input 'auth-token.json' @{
        microvmIdentifier   = $id
        expirationInMinutes = 60
        allowedPorts        = @(@{ port = 8765 }, @{ port = 9000 })
    }
    $answer = Invoke-Aws lambda-microvms create-microvm-auth-token --cli-input-json $request
    Save-State ENDPOINT $microvm.endpoint
    Save-State TOKEN $answer.authToken.'X-aws-proxy-auth'
    Write-Host "OK: token for $($microvm.endpoint), valid 60 minutes"
}

function Step-Check {
    $endpoint = Need ENDPOINT
    $token = Need TOKEN
    $shots = New-Item -ItemType Directory -Force (Join-Path $Build 'shots')
    $auth = @{ 'X-aws-proxy-auth' = $token }
    $common = @{ SkipHttpErrorCheck = $true; TimeoutSec = 60 }
    $ready = Invoke-WebRequest "https://$endpoint$Hook/ready" -Headers ($auth + @{ 'X-aws-proxy-port' = '9000' }) @common
    Write-Host "ready: $($ready.StatusCode)"
    $me = $auth + @{ 'X-aws-proxy-port' = '8765' }
    $index = Invoke-WebRequest "https://$endpoint/" -Headers $me -SessionVariable session @common
    Write-Host "index: $($index.StatusCode)"
    $login = Invoke-WebRequest "https://$endpoint/login" -Method Post -Headers $me -WebSession $session `
        -ContentType 'application/json' -Body '{"username":"admin","password":""}' @common
    Write-Host "login: $($login.StatusCode) $($login.Content)"
    $stamp = (Get-Date).ToUniversalTime().ToString('HHmmss')
    foreach ($camera in 1..4) {
        $file = Join-Path $shots "cam$camera-$stamp.jpg"
        $started = Get-Date
        $picture = Invoke-WebRequest "https://$endpoint/picture/$camera/current/" -Headers $me -WebSession $session -OutFile $file -PassThru @common
        $seconds = ((Get-Date) - $started).TotalSeconds
        Write-Host ("camera {0}: {1} {2} {3} bytes {4:N2}s" -f $camera, $picture.StatusCode, $picture.Headers['Content-Type'], (Get-Item $file).Length, $seconds)
    }
    Write-Host "OK: pictures saved under $shots"
}

function Step-Suspend {
    Invoke-Aws lambda-microvms suspend-microvm --microvm-identifier (Need MICROVM) | Out-Null
    Write-Host 'OK: suspend requested'
}

function Step-Terminate {
    Invoke-Aws lambda-microvms terminate-microvm --microvm-identifier (Need MICROVM) | Out-Null
    Write-Host 'OK: terminate requested'
}

function Step-Proxy {
    $account = Need ACCOUNT
    $imageArn = Image-Arn
    $zip = Join-Path $Build 'proxy.zip'
    if (Test-Path $zip) { Remove-Item $zip }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $PSScriptRoot 'proxy\index.mjs'), 'index.mjs') | Out-Null
    } finally {
        $archive.Dispose()
    }
    $state = Read-State
    if (-not $state.PROXY_ROLE_ARN) {
        Invoke-Aws logs create-log-group --log-group-name $ProxyLogGroup | Out-Null
        Invoke-Aws logs put-retention-policy --log-group-name $ProxyLogGroup --retention-in-days 7 | Out-Null
        $trust = Write-Input 'trust-proxy.json' @{
            Version   = '2012-10-17'
            Statement = @(@{ Effect = 'Allow'; Principal = @{ Service = 'lambda.amazonaws.com' }; Action = 'sts:AssumeRole' })
        }
        Invoke-Aws iam create-role --role-name $Proxy --assume-role-policy-document $trust | Out-Null
        Save-State PROXY_ROLE_ARN "arn:aws:iam::${account}:role/$Proxy"
    }
    $policy = Write-Input 'policy-proxy.json' @{
        Version   = '2012-10-17'
        Statement = @(
            @{ Effect = 'Allow'; Action = @('lambda:RunMicrovm', 'lambda:GetMicrovm', 'lambda:CreateMicrovmAuthToken'); Resource = $imageArn }
            @{ Effect = 'Allow'; Action = 'lambda:ListMicrovms'; Resource = '*' }
            @{ Effect = 'Allow'; Action = 'lambda:PassNetworkConnector'; Resource = '*' }
            @{ Effect = 'Allow'; Action = @('logs:CreateLogStream', 'logs:PutLogEvents'); Resource = "arn:aws:logs:${Region}:${account}:log-group:${ProxyLogGroup}:*" }
        )
    }
    Invoke-Aws iam put-role-policy --role-name $Proxy --policy-name proxy --policy-document $policy | Out-Null
    if (-not (Read-State).ACCESS_KEY) {
        $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
        Save-State ACCESS_KEY ([Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('='))
    }
    $environment = Write-Input 'proxy-environment.json' @{
        Variables = @{ IMAGE_ARN = $imageArn; INGRESS_CONNECTOR = "${Connector}:ALL_INGRESS"; ACCESS_KEY = Need ACCESS_KEY }
    }
    if (-not (Read-State).PROXY_URL) {
        Start-Sleep -Seconds 10
        Invoke-Aws lambda create-function --function-name $Proxy --runtime nodejs24.x --architectures arm64 `
            --handler index.handler --role (Need PROXY_ROLE_ARN) --zip-file fileb:///build/proxy.zip `
            --memory-size 256 --timeout 60 --logging-config "LogFormat=Text,LogGroup=$ProxyLogGroup" `
            --environment $environment | Out-Null
        Invoke-Aws lambda wait function-active-v2 --function-name $Proxy | Out-Null
        $url = Invoke-Aws lambda create-function-url-config --function-name $Proxy --auth-type NONE --invoke-mode RESPONSE_STREAM
        Invoke-Aws lambda add-permission --function-name $Proxy --statement-id public-function-url `
            --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE | Out-Null
        Invoke-Aws lambda add-permission --function-name $Proxy --statement-id public-function-url-invoke `
            --action lambda:InvokeFunction --principal '*' --invoked-via-function-url | Out-Null
        Save-State PROXY_URL $url.FunctionUrl
        Write-Host "OK: proxy $Proxy created with a public function URL"
    } else {
        Invoke-Aws lambda update-function-code --function-name $Proxy --zip-file fileb:///build/proxy.zip | Out-Null
        Invoke-Aws lambda wait function-updated-v2 --function-name $Proxy | Out-Null
        Invoke-Aws lambda update-function-configuration --function-name $Proxy --environment $environment | Out-Null
        Write-Host "OK: proxy $Proxy updated"
    }
    Step-Link
}

function Step-Link {
    Write-Host "LINK: $(Need PROXY_URL)?vivarium-key=$(Need ACCESS_KEY)"
}

function Step-Logs([string] $Group, [string] $Since) {
    Invoke-Aws logs tail $Group --since ($Since ? $Since : '1h')
}

function Step-Cleanup {
    $state = Read-State
    $attempts = @(
        { Invoke-Aws lambda delete-function --function-name $Proxy }
        { Invoke-Aws iam delete-role-policy --role-name $Proxy --policy-name proxy }
        { Invoke-Aws iam delete-role --role-name $Proxy }
        { Invoke-Aws logs delete-log-group --log-group-name $ProxyLogGroup }
        { Invoke-Aws lambda-microvms delete-microvm-image --image-identifier (Image-Arn) }
        { Invoke-Aws s3 rm "s3://$($state.BUCKET)" --recursive }
        { Invoke-Aws s3api delete-bucket --bucket $state.BUCKET }
        { Invoke-Aws iam delete-role-policy --role-name $BuildRole --policy-name build }
        { Invoke-Aws iam delete-role --role-name $BuildRole }
        { Invoke-Aws logs delete-log-group --log-group-name $LogGroup }
    )
    foreach ($attempt in $attempts) {
        try { & $attempt | Out-Null; Write-Host "OK: $($attempt.ToString().Trim())" }
        catch { Write-Host "SKIPPED: $($attempt.ToString().Trim()) ($($_.Exception.Message))" }
    }
    Remove-Item $StateFile -ErrorAction SilentlyContinue
}

switch ($Command) {
    'setup' { Step-Setup }
    'image' { Step-Image $Argument }
    'status' { Step-Status }
    'version' { Step-Version $Argument }
    'logs' { Step-Logs $LogGroup $Argument }
    'run' { Step-Run }
    'vm' { Step-Vm }
    'token' { Step-Token }
    'check' { Step-Check }
    'suspend' { Step-Suspend }
    'terminate' { Step-Terminate }
    'proxy' { Step-Proxy }
    'link' { Step-Link }
    'proxy-logs' { Step-Logs $ProxyLogGroup $Argument }
    'cleanup' { Step-Cleanup }
    default {
        Write-Host 'usage: aws.ps1 setup | image <commit> | status | version [n] | logs [since] | run | vm | token | check | suspend | terminate | proxy | link | proxy-logs [since] | cleanup'
        exit 2
    }
}
