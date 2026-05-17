import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// SSO-only login. Email/password is intentionally not exposed; the
// underlying signIn/signUp still exist in AuthContext as a break-glass
// path but have no UI.
export default function Auth() {
  const { signInWithSSO } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Dreadroot</CardTitle>
          <CardDescription className="text-center">
            Sign in with your Lightningworks account to play
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" className="w-full" onClick={signInWithSSO}>
            Sign in with Lightningworks
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
