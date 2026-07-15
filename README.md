# Resume Composer — AI Resume Maker

Full-stack resume builder with a Node.js/Express backend that proxies
**streaming** responses from the Anthropic Claude API. The frontend is
plain, responsive HTML/CSS/JS — no build step required.

```
resume-maker-app/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── .env.example
├── package.json
├── server.js          # Express server + secure streaming proxy to Claude
└── public/
    ├── index.html
    ├── styles.css
    └── app.js          # form, live preview, SSE streaming client
```

## How it works

- The browser never talks to Anthropic directly and never sees an API key.
- The browser calls `POST /api/enhance` on **our own server**.
- The server builds the prompt, calls the Claude API with `stream: true`,
  and re-streams the tokens back to the browser over Server-Sent Events
  as they arrive — so AI text appears progressively, not all at once.
- `ANTHROPIC_API_KEY` is read only from `process.env` on the server and
  is never bundled into any file the browser downloads.

## Run locally (no Docker)

```bash
npm install
cp .env.example .env
# edit .env and paste your real ANTHROPIC_API_KEY
npm start
# open http://localhost:8080
```

## Run with Docker

```bash
cp .env.example .env
# edit .env with your real key

docker build -t resume-maker-app .
docker run --rm -p 8080:8080 --env-file .env resume-maker-app
# open http://localhost:8080
```

Or with Compose:

```bash
docker compose up --build
```

## Deploying to AWS (App Runner + ECR)

These are the exact commands to run from your own machine, using your
own AWS account and credentials. I can't create resources in your AWS
account for you, but every step below is copy/paste-ready.

### 1. Push the image to Amazon ECR

```bash
aws configure                      # if not already set up
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws ecr create-repository --repository-name resume-maker-app --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker build -t resume-maker-app .
docker tag resume-maker-app:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/resume-maker-app:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/resume-maker-app:latest
```

### 2. Store the API key as a secret

```bash
aws secretsmanager create-secret \
  --name resume-maker/anthropic-api-key \
  --secret-string "sk-ant-your-real-key"
```

### 3. Create the App Runner service

Easiest path is the console: **App Runner → Create service → Container
registry → Amazon ECR** → pick the `resume-maker-app:latest` image →
port `8080`.

Or via CLI:

```bash
aws apprunner create-service \
  --service-name resume-maker-app \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "'"$ACCOUNT_ID"'.dkr.ecr.'"$AWS_REGION"'.amazonaws.com/resume-maker-app:latest",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentSecrets": {
          "ANTHROPIC_API_KEY": "arn:aws:secretsmanager:'"$AWS_REGION"':'"$ACCOUNT_ID"':secret:resume-maker/anthropic-api-key"
        }
      },
      "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": true
  }' \
  --instance-configuration '{"Cpu": "1024", "Memory": "2048"}'
```

App Runner provisions a public **HTTPS URL** automatically (something
like `https://xxxxxxxxxx.us-east-1.awsapprunner.com`) — no separate
load balancer or certificate setup needed.

### 4. Verify

```bash
curl https://<your-app-runner-url>/api/health
# {"status":"ok"}
```

Then open the URL in a browser to use the app.

## Security notes

- `.env` is git-ignored and docker-ignored — it never reaches version
  control or the image.
- The Claude API key lives only in the server process's environment
  (locally in `.env`, in production in App Runner's runtime secret,
  backed by AWS Secrets Manager).
- All prompt construction happens server-side in `server.js`, so the
  client can only select a task type (`summary`, `bullets`, `project`)
  and supply resume field values — it can't inject arbitrary system
  instructions into the request.
- `/api/health` is unauthenticated and returns no sensitive data, so
  it's safe to use as an App Runner / load balancer health check.
