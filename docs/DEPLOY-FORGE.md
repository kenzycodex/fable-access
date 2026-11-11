# Deploying to the Forge cluster (team11)

Two workloads run in the `team11` namespace:

| Workload | What it is | Reachable from |
| --- | --- | --- |
| `app` | The website (Next.js). The one Service the platform publishes: it must be named `app` and listen on port 80. | The internet, at `https://team11.xtradot.co` |
| `api` | The Fable API (FastAPI). | Inside the namespace only, as `http://api` |

The browser only ever talks to the site. The site forwards `/fable-api/...` to
`http://api` inside the cluster, so the API never needs a public address and the
Cloudflare login that guards the public route is not in the way of API calls.
The bank sandbox and the model endpoint only answer from inside the cluster, so
only the API calls them.

Three things never go in Git, chat, screenshots or a recording: the kubeconfig
(`team11.yml`), the team key (`GATEWAY_KEY`) and the webhook secret.

## Once

```bash
export KUBECONFIG=~/forge/team11.yml
kubectl auth can-i create deployments        # yes
```

Let the cluster pull the private images. The token is a GitHub personal access
token with only `read:packages`:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=ghcr.io --docker-username=kenzycodex --docker-password=<token>
```

Create Fable's own settings. Generate each value on your machine and keep a copy
of the pepper and the secrets key in a password manager, because data written
with them cannot be read without them:

```bash
kubectl create secret generic fable-env \
  --from-literal=FABLE_SESSION_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  --from-literal=FABLE_PIN_PEPPER="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  --from-literal=FABLE_SECRETS_KEY="$(python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')" \
  --from-literal=FABLE_SECRETS_KEY_ID=k1 \
  --from-literal=FRONTEND_URL=https://team11.xtradot.co \
  --from-literal=FABLE_CORS_ORIGINS=https://team11.xtradot.co \
  --from-literal=WEBAUTHN_RP_ID=team11.xtradot.co \
  --from-literal=WEBAUTHN_ORIGINS=https://team11.xtradot.co
```

## Each release

1. Merge to `main`. The "Images" workflow builds both images for `linux/amd64`
   and pushes `fable-access-api` and `fable-access-web`, each tagged with the
   first 12 characters of the commit. The tag is in the workflow's summary.
2. Deploy that tag:

   ```bash
   kubectl apply -f deploy/forge/app.yaml          # first time only
   kubectl set image deployment/api api=ghcr.io/kenzycodex/fable-access-api:<tag>
   kubectl set image deployment/app app=ghcr.io/kenzycodex/fable-access-web:<tag>
   kubectl rollout status deployment/api
   kubectl rollout status deployment/app
   ```

3. Check it. The public address is not visible until demo day, so test from
   inside the namespace (the platform guide, section 8.1):

   ```bash
   kubectl get pods
   kubectl logs deploy/api --tail=50
   kubectl port-forward svc/app 8080:80              # then open http://localhost:8080
   ```

## Testing the bank and the model from a pod

The bank sandbox and the model endpoint do not answer from your laptop. Use a
throwaway pod:

```bash
kubectl run curl --image=curlimages/curl --restart=Never -- sleep 3600
kubectl wait pod/curl --for=condition=Ready --timeout=60s
KEY=$(kubectl get secret huawei-gateway -o jsonpath='{.data.GATEWAY_KEY}' | base64 --decode)
kubectl exec curl -- curl -s -H "x-api-key: $KEY" \
  http://bank-api.ingress-apisix.svc.cluster.local/v1/accounts/0123456789/balance
kubectl delete pod curl
```

The key is shared by the bank and the model: 60 requests a minute for the whole
team, so keep rehearsals slow.

## First run

The database starts empty. Create the operator, then provision the institution
from `/operator` on the site and set it to live mode (Fable's own simulated
ledger stays out of it, and the bank's balance is the only one used):

```bash
kubectl exec -it deploy/api -- python scripts/create_operator.py
```

Register the bank's webhook. The bank returns the signing secret once; add it to
the cluster secret straight away and restart the API:

```bash
kubectl exec deploy/api -- python scripts/forge_register_webhook.py
kubectl patch secret fable-env -p "{\"stringData\":{\"FORGE_WEBHOOK_SECRET\":\"<the secret>\"}}"
kubectl rollout restart deployment/api
```

## Sandbox data can reset

`POST /admin/reset`, or a platform restart, puts the bank back to its opening
balances, so do not rely on sandbox data surviving overnight and keep Fable's
own records. Keys are revoked when the event closes; export anything you need
before then.

## Going back

```bash
kubectl rollout undo deployment/api
kubectl rollout undo deployment/app
```

## If something is wrong

| What you see | Likely cause | Fix |
| --- | --- | --- |
| `ImagePullBackOff` | `regcred` missing or its token expired | Recreate the secret |
| Pod `Pending`, "exceeded quota" | Requests above the namespace quota | `kubectl describe resourcequota team-quota` |
| Pod never Ready | The process did not start | `kubectl logs deploy/api --previous` |
| `api` exits at start naming unsafe settings | `fable-env` is missing a value | Recreate the secret from "Once" |
| `/health` says the database is not writable | The volume is not writable by uid 10001 | Check `fsGroup: 10001` is still in the manifest |
| The site loads but every call fails | `api` is not Ready, or the site was built for another API address | `kubectl get pods`; rebuild the web image |
| 502 or 404 on the public address | Service renamed, or the route is not open yet | The published Service must be `app`, port 80; ask the platform team to open the route |
| 429 from the bank | More than 60 requests a minute, shared with the model | Slow down and cache |
