import { Box, Button, useToast, VStack, Text } from '@chakra-ui/react'
import { DownloadIcon, RepeatIcon } from '@chakra-ui/icons'
import React, { useContext, useState } from 'react'
import { SettingsContext } from '../../../util/settingsContext'

export const SettingsPanel: React.FC = () => {
  const settings = useContext(SettingsContext)
  const [operation, setOperation] = useState<'save' | 'restore' | null>(null)
  const toast = useToast()
  const run = async (action: 'save' | 'restore') => {
    setOperation(action)
    try {
      const description = await settings[action]()
      toast({ title: action === 'save' ? 'Settings saved' : 'Settings restored', description, status: 'success', duration: 4000, isClosable: true })
    } catch (error) {
      toast({ title: 'Settings request failed', description: error instanceof Error ? error.message : 'Could not update settings', status: 'error', duration: 7000, isClosable: true })
    } finally {
      setOperation(null)
    }
  }
  return (
    <Box>
      <VStack spacing={4} align="stretch" p={4}>
        <Text fontSize="sm" color="gray.600">
          Save to the shared settings file in your Emacs configuration, or restore it here.
        </Text>
        {!settings.connected && <Text fontSize="sm">Connect to Emacs to save or restore settings.</Text>}
        <Button leftIcon={<DownloadIcon />} variant="outline" size="sm" onClick={() => run('save')}
          isDisabled={!settings.connected || operation !== null} isLoading={operation === 'save'}>
          Save settings
        </Button>
        <Button leftIcon={<RepeatIcon />} variant="outline" size="sm" onClick={() => run('restore')}
          isDisabled={!settings.connected || operation !== null} isLoading={operation === 'restore'}>
          Restore saved settings
        </Button>
      </VStack>
    </Box>
  )
}
