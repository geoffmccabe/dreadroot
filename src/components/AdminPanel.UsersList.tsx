import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState } from 'react';
import type { UserData, UsersListProps } from './adminPanel.types';

export function UsersList({}: UsersListProps) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showWithoutProfiles, setShowWithoutProfiles] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [editCoinsOpen, setEditCoinsOpen] = useState(false);
  const [manageRolesOpen, setManageRolesOpen] = useState(false);
  const [coinsInput, setCoinsInput] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-all-users');

      if (error) throw error;
      if (!data?.users) throw new Error('No users data returned');

      setUsers(data.users);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast({
        title: "Error",
        description: "Failed to load users. Make sure you have admin privileges.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditCoins = (user: any) => {
    setSelectedUser(user);
    setCoinsInput(user.profile?.coins?.toString() || '0');
    setEditCoinsOpen(true);
  };

  const handleManageRoles = (user: any) => {
    setSelectedUser(user);
    setSelectedRoles(user.roles || ['user']);
    setManageRolesOpen(true);
  };

  const saveCoins = async () => {
    if (!selectedUser) return;
    
    const newCoins = parseInt(coinsInput);
    if (isNaN(newCoins) || newCoins < 0) {
      toast({
        title: "Invalid Input",
        description: "Please enter a valid number",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ coins: newCoins })
        .eq('user_id', selectedUser.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "User coins updated successfully",
      });
      
      setEditCoinsOpen(false);
      loadUsers();
    } catch (error) {
      console.error('Failed to update coins:', error);
      toast({
        title: "Error",
        description: "Failed to update coins",
        variant: "destructive",
      });
    }
  };

  const saveRoles = async () => {
    if (!selectedUser) return;

    try {
      // Delete existing roles
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', selectedUser.id);

      // Insert new roles
      if (selectedRoles.length > 0) {
        const { error } = await supabase
          .from('user_roles')
          .insert(selectedRoles.map(role => ({
            user_id: selectedUser.id,
            role: role as 'user' | 'moderator' | 'admin' | 'superadmin'
          })));

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "User roles updated successfully",
      });
      
      setManageRolesOpen(false);
      loadUsers();
    } catch (error) {
      console.error('Failed to update roles:', error);
      toast({
        title: "Error",
        description: "Failed to update roles",
        variant: "destructive",
      });
    }
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const cleanupFakeUsers = async () => {
    if (!confirm(`This will permanently delete ${users.filter(u => !u.has_profile).length} users without profiles. Continue?`)) {
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('cleanup-fake-users');

      if (error) throw error;

      toast({
        title: "Cleanup Complete",
        description: `Deleted ${data.deleted_count} fake users`,
      });

      await loadUsers();
    } catch (error) {
      console.error('Failed to cleanup users:', error);
      toast({
        title: "Error",
        description: "Failed to delete fake users",
        variant: "destructive",
      });
    }
  };

  const filteredUsers = users.filter(user => {
    // Filter by profile status
    if (!showWithoutProfiles && !user.has_profile) {
      return false;
    }
    
    // Filter by search term
    return (
      user.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.profile?.blockchain_address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.roles?.some(r => r.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  if (loading) {
    return <div className="text-sm opacity-75">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search by email, user ID, wallet, or role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-2">
          <Checkbox 
            id="show-without-profiles"
            checked={showWithoutProfiles}
            onCheckedChange={(checked) => setShowWithoutProfiles(checked as boolean)}
          />
          <Label htmlFor="show-without-profiles" className="text-sm cursor-pointer">
            Show users without profiles ({users.filter(u => !u.has_profile).length})
          </Label>
        </div>
        <Button variant="outline" size="sm" onClick={loadUsers}>
          Refresh
        </Button>
        {users.filter(u => !u.has_profile).length > 0 && (
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={cleanupFakeUsers}
          >
            Delete {users.filter(u => !u.has_profile).length} Fake Users
          </Button>
        )}
      </div>

      <ScrollArea className="h-[500px] w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email / User ID</TableHead>
              <TableHead>Roles & Status</TableHead>
              <TableHead>Inventory</TableHead>
              <TableHead>Coin Balances</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => {
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{user.email}</span>
                      <span className="font-mono text-xs text-muted-foreground" title={user.id}>
                        {user.id.slice(0, 8)}...
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {user.roles.length > 0 ? (
                        user.roles.map(role => (
                          <Badge 
                            key={role} 
                            variant={role === 'superadmin' || role === 'admin' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {role}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-xs">user</Badge>
                      )}
                      {!user.has_profile && (
                        <Badge variant="destructive" className="text-xs">No Profile</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{user.inventory_count} items</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {user.token_balances.length > 0 ? (
                        user.token_balances.map((balance, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium">{balance.theme_name}:</span>{' '}
                            <span className="text-muted-foreground">{balance.coins}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No balances</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {user.profile?.blockchain_address ? `${user.profile.blockchain_address.slice(0, 6)}...` : '-'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleEditCoins(user)}
                        disabled={!user.has_profile}
                        title={!user.has_profile ? 'User needs a profile first' : 'Edit coins'}
                      >
                        Edit Coins
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleManageRoles(user)}
                      >
                        Roles
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Edit Coins Dialog */}
      <Dialog open={editCoinsOpen} onOpenChange={setEditCoinsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Coins</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User ID</Label>
              <div className="font-mono text-xs opacity-50 mt-1">
                {selectedUser?.id}
              </div>
            </div>
            <div>
              <Label htmlFor="coins">Coins</Label>
              <Input
                id="coins"
                type="number"
                value={coinsInput}
                onChange={(e) => setCoinsInput(e.target.value)}
                min="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCoinsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCoins}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Roles Dialog */}
      <Dialog open={manageRolesOpen} onOpenChange={setManageRolesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage User Roles</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User ID</Label>
              <div className="font-mono text-xs opacity-50 mt-1">
                {selectedUser?.id}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="space-y-2">
                {['user', 'moderator', 'admin', 'superadmin'].map(role => (
                  <div key={role} className="flex items-center space-x-2">
                    <Checkbox
                      id={role}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={() => toggleRole(role)}
                    />
                    <Label htmlFor={role} className="capitalize cursor-pointer">
                      {role}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageRolesOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveRoles}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// AdminPanel uses database field names directly (texture_url, glow_factor)
// This differs from BlockType which uses nested structure (texture.diffuse, properties.glowFactor)
