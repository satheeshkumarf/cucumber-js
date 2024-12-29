import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { ILogger } from '../logger'
import { IConfiguration } from './types'
import { mergeConfigurations } from './merge_configurations'
import { parseConfiguration } from './parse_configuration'

export async function fromFile(
  logger: ILogger,
  cwd: string,
  file: string,
  profiles: string[] = []
): Promise<Partial<IConfiguration>> {
  let definitions = await loadFile(logger, cwd, file)

  const defaultDefinition: unknown = definitions.default

  if (defaultDefinition) {
    if (typeof defaultDefinition === 'function') {
      logger.debug('Default function found; loading profiles')
      definitions = await handleDefaultFunctionDefinition(
        definitions,
        defaultDefinition
      )
    }
  } else {
    logger.debug('No default profile defined in configuration file')
    definitions.default = {}
  }

  if (profiles.length < 1) {
    logger.debug('No profiles specified; using default profile')
    profiles = ['default']
  }

  const definedKeys = Object.keys(definitions)
  profiles.forEach((profileKey) => {
    if (!definedKeys.includes(profileKey)) {
      throw new Error(`Requested profile "${profileKey}" doesn't exist`)
    }
  })
  return mergeConfigurations(
    {},
    ...profiles.map((profileKey) =>
      parseConfiguration(
        logger,
        `Profile "${profileKey}"`,
        definitions[profileKey]
      )
    )
  )
}

async function handleDefaultFunctionDefinition(
  definitions: Record<string, any>,
  defaultDefinition: Function
): Promise<Record<string, any>> {
  if (Object.keys(definitions).length > 1) {
    throw new Error(
      'Invalid profiles specified: if a default function definition is provided, no other static profiles should be specified'
    )
  }

  const definitionsFromDefault = await defaultDefinition()

  return {
    default: {},
    ...definitionsFromDefault,
  }
}

async function loadFile(
  logger: ILogger,
  cwd: string,
  file: string
): Promise<Record<string, any>> {
  const filePath: string = path.join(cwd, file)
  const extension = path.extname(filePath)
  let definitions
  switch (extension) {
    case '.json':
      definitions = JSON.parse(
        await promisify(fs.readFile)(filePath, { encoding: 'utf-8' })
      )
      break
    case '.yaml':
    case '.yml':
      definitions = YAML.parse(
        await promisify(fs.readFile)(filePath, { encoding: 'utf-8' })
      )
      break
    case '.cjs':
    case '.js':
    case '.mjs': {
      logger.debug(
        `Loading configuration file "${file}" as JavaScript based on extension`
      )
      const ambiguous = await import(pathToFileURL(filePath).toString())
      if ('module.exports' in ambiguous) {
        logger.debug(
          `Treating configuration file "${file}" as CommonJS based on heuristics`
        )
        definitions = ambiguous['module.exports']
      } else {
        logger.debug(
          `Treating configuration file "${file}" as ESM based on heuristics`
        )
        definitions = ambiguous
      }
      break
    }
    default:
      throw new Error(`Unsupported configuration file extension "${extension}"`)
  }
  if (typeof definitions !== 'object') {
    throw new Error(`Configuration file ${filePath} does not export an object`)
  }
  return definitions
}
