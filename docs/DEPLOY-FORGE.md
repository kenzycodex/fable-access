# Deploying to the Forge cluster (team11)

The API runs as one pod in the `team11` namespace behind a Service called
`app` on port 80, which the platform publishes at `https://team11.xtradot.co`.
The website stays on Vercel and calls that address.

Two things never go in Git, chat, screenshots or a recording: the kubeconfig
(`team11.yml`) and the team key (`GATEWAY_KEY`).

## Once

```bash
export KUBECONFIG=~/forge/team11.yml
kubectl auth can-i create deployments        # yes
```

Let the cluster pull the private image. The token is a GitHub personal access
token with only `read:packages`:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=ghcr.io --docker-username=kenzycodex --docker-password=<token>
```

Create Fable's own settings. Generate each value on your machine; keep a copy
of the pepper and the secrets key in a password manager, because data written
with them cannot be read without them:

```bash
kubectl create secret generic fable-env \
  --from-literal=FABLE_SESSION_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  --from-literal=FABLE_PIN_PEPPER="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  --from-literal=FABLE_SECRETS_KEY="$(python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')" \
  --from-literal=FABLE_SECRETS_KEY_ID=k1 \
  --from-literal=FRONTEND_URL=https://<the Vercel site> \
  --from-literal=FABLE_CORS_ORIGINS=https://<the Vercel site> \
  --from-literal=WEBAUTHN_RP_ID=<the Vercel site's host> \
  --from-literal=WEBAUTHN_ORIGINS=https://<the Vercel site>
```

## Each release

1. Merge to `main`. The "API image" workflow builds for `linux/amd64` and
   pushes `ghcr.io/kenzycodex/fable-access-api:<first 12 characters of the
   commit>`. The tag is in the workflow's summary.
2. Deploy that tag:

   ```bash
   kubectl apply -f deploy/forge/app.yaml          # first time only
   kubectl set image deployment/app app=ghcr.io/kenzycodex/fable-access-api:<tag>
   kubectl rollout status deployment/app
   ```

3. Check it from inside the namespace. The public address may not be open yet,
   and the bank and model endpoints only answer from inside:

   ```bash
   kubectl get pods
   kubectl logs deploy/app --tail=50
   kubectl run curl-test --rm -it --restart=Never --image=curlimages/curl -- \
     curl -s http://app.team11.svc.cluster.local/health
   kubectl port-forward svc/app 8080:80              # then open localhost:8080/docs
   ```

`/healthz` answers 200 whenever the process is up, and is what the cluster
probes. `/health` is the full report and answers 503 when scoring cannot work.

## First run

The database starts empty. Create the operator, then provision the institution
from `/operator` on the site:

```bash
kubectl exec -it deploy/app -- python scripts/create_operator.py
```

## Going back

```bash
kubectl rollout undo deployment/app
```

## If something is wrong

| What you see | Likely cause | Fix |
| --- | --- | --- |
| `ImagePullBackOff` | `regcred` missing or its token expired | Recreate the secret |
| Pod `Pending`, "exceeded quota" | Requests above the namespace quota | `kubectl describe resourcequota team-quota` |
| Pod never Ready | The process did not start | `kubectl logs deploy/app --previous` |
| `/health` says the database is not writable | The volume is not writable by uid 10001 | Check `fsGroup: 10001` is still in the manifest |
| 502 or 404 on the public address | Service renamed, or the route is not open yet | Service must be `app`, port 80; ask the platform team to open the route |
