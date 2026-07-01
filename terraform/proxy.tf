# Gemini proxy: a Lambda (Function URL, response streaming) that holds
# GEMINI_API_KEY server-side so it never ships in the client bundle, plus a
# DynamoDB table backing per-IP / per-device rate limiting. Source: ../lambda/.
#
# NOTE: run `npm install --omit=dev` in ../lambda before `terraform apply` —
# this zips the directory as-is and the handler needs its node_modules.

data "archive_file" "proxy" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda"
  output_path = "${path.module}/gemini-proxy.zip"
}

# Rate-limit counters: atomic ADD per (ip|device, minute|day) bucket, TTL cleanup.
resource "aws_dynamodb_table" "ratelimit" {
  name         = "${var.app_name}-ratelimit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

data "aws_iam_policy_document" "proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.app_name}-proxy-role"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
}

resource "aws_iam_role_policy_attachment" "proxy_basic" {
  role       = aws_iam_role.proxy.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Least privilege: the handler only ever calls UpdateItem on the counter table.
resource "aws_iam_role_policy" "proxy_ddb" {
  name = "${var.app_name}-proxy-ddb"
  role = aws_iam_role.proxy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.ratelimit.arn
    }]
  })
}

# Pre-create the log group so it gets a retention policy instead of Lambda
# auto-creating a never-expiring one.
resource "aws_cloudwatch_log_group" "proxy" {
  name              = "/aws/lambda/${var.app_name}-gemini-proxy"
  retention_in_days = 14
}

resource "aws_lambda_function" "proxy" {
  function_name    = "${var.app_name}-gemini-proxy"
  role             = aws_iam_role.proxy.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.proxy.output_path
  source_code_hash = data.archive_file.proxy.output_base64sha256
  timeout          = 60
  memory_size      = 512

  environment {
    variables = {
      GEMINI_API_KEY = var.gemini_api_key
      DDB_TABLE_NAME = aws_dynamodb_table.ratelimit.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.proxy_basic,
    aws_cloudwatch_log_group.proxy,
  ]
}

resource "aws_lambda_function_url" "proxy" {
  function_name      = aws_lambda_function.proxy.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"

  cors {
    allow_origins = split(",", var.allowed_origins)
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

# Function URL with authorization_type NONE still needs an explicit public
# invoke permission (missing it returns 403).
resource "aws_lambda_permission" "proxy_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.proxy.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}
