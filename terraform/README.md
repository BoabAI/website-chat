# Terraform AWS Amplify Deployment

This Terraform configuration deploys the Website Chat application to AWS Amplify.

## Prerequisites

1. **AWS CLI** configured with credentials
2. **Terraform** >= 1.0 installed
3. **GitHub Personal Access Token** with `repo` scope
4. **Gemini API Key** from Google AI Studio

## Quick Start

### 1. Create GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Generate new token (classic)
3. Select `repo` scope (full control of private repositories)
4. Copy the token

### 2. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:
- `github_token` - Your GitHub PAT
- `gemini_api_key` - Your Gemini API key

Or use environment variables:
```bash
export TF_VAR_github_token="ghp_xxxxx"
export TF_VAR_gemini_api_key="your-key"
```

### 3. Deploy

```bash
terraform init
terraform plan
terraform apply
```

### 4. Access Your App

After deployment, Terraform will output the app URL:
```
app_url = "https://main.d1234abcdefg.amplifyapp.com"
```

## Outputs

| Output | Description |
|--------|-------------|
| `app_url` | URL to access the deployed application |
| `app_id` | Amplify App ID |
| `console_url` | AWS Console URL for the app |

## CI/CD

Once deployed, Amplify will automatically:
- Build on every push to `main` branch
- Deploy new versions automatically
- Show build status in GitHub

## Costs

AWS Amplify Free Tier (per month):
- 5 GB hosted
- 15 GB served
- 500 build minutes

Typical small site: **FREE**

## Destroy

To remove all resources:
```bash
terraform destroy
```

## Troubleshooting

### Build Fails
1. Check Amplify console for build logs
2. Ensure `npm run build` works locally
3. Verify environment variables are set

### GitHub Connection Issues
1. Verify token has `repo` scope
2. Token must not be expired
3. Repository must be accessible with the token

### Permission Errors
Ensure your AWS credentials have permissions for:
- `amplify:*`
- IAM roles for Amplify service
