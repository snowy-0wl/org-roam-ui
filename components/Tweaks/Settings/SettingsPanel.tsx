import { Box, Button, useToast, VStack, Text } from '@chakra-ui/react';
import { DownloadIcon, ArrowUpIcon } from '@chakra-ui/icons';
import React, { useRef } from 'react';
import { exportSettings, importSettings } from '../../../util/settings-manager';

export const SettingsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleExport = () => {
    try {
      const settings = exportSettings();
      const blob = new Blob([settings], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'org-roam-ui-settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Settings exported',
        description: 'Your settings have been saved to org-roam-ui-settings.json',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: 'Failed to export settings',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        
        // Show loading toast
        toast({
          title: 'Importing settings...',
          description: 'Please wait while your settings are being imported',
          status: 'info',
          duration: 1000,
          isClosable: false,
        });

        // Import settings
        importSettings(content);

        // Show success toast
        toast({
          title: 'Settings imported',
          description: 'Your settings have been imported successfully. Reloading page...',
          status: 'success',
          duration: 2000,
          isClosable: true,
        });

        // Give more time for the settings to be saved before reload
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } catch (error) {
        toast({
          title: 'Import failed',
          description: `Failed to import settings: ${error.message}`,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    };

    reader.onerror = () => {
      toast({
        title: 'Import failed',
        description: 'Failed to read the settings file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    };

    reader.readAsText(file);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Box>
      <VStack spacing={4} align="stretch" p={4}>
        <Text fontSize="sm" color="gray.600">
          Export your current settings to a file or import settings from a previously exported file.
        </Text>
        <Button
          leftIcon={<DownloadIcon />}
          colorScheme="blue"
          variant="outline"
          onClick={handleExport}
          size="sm"
        >
          Export Settings
        </Button>
        <Button
          leftIcon={<ArrowUpIcon />}
          colorScheme="blue"
          variant="outline"
          onClick={handleImportClick}
          size="sm"
        >
          Import Settings
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          accept=".json"
          style={{ display: 'none' }}
        />
      </VStack>
    </Box>
  );
};
