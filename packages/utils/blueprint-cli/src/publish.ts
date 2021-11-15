import * as fs from 'fs';
import * as path from 'path';
import * as axios from 'axios';
import * as pino from 'pino';
import * as yargs from 'yargs';

export interface PublishOptions extends yargs.Arguments {
  blueprint: string;
  publisher: string;
  cookie?: string;
}

interface PublishingJob {
  publishingJobId: string;
  uploadUrl: string;
}

export async function publish(
  log: pino.BaseLogger,
  blueprint: string,
  publisher: string,
  cookie?: string,
): Promise<void> {
  if (!fs.existsSync(blueprint)) {
    log.error('blueprint directory does not exist: %s', blueprint);
    process.exit(255);
  }

  cookie = cookie ?? process.env.CAWS_COOKIE;
  if (!cookie) {
    log.error('caws cookie was not provided by cli or environment');
    process.exit(200);
  }

  const packageJsonPath = path.join(blueprint, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    log.error('blueprint path does not contain a `package.json`, expected: %s', packageJsonPath);
    process.exit(255);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const fullyQualifiedBlueprintName: string = packageJson.name;
  const friendlyBlueprintName = fullyQualifiedBlueprintName.split('.').pop();
  const version = packageJson.version;

  const distributionFolder = path.join(blueprint, 'dist', 'js');
  if (!fs.existsSync(distributionFolder)) {
    log.error(
      'package has not yet been published locally, have you run blueprint:synth? expected: %s',
      distributionFolder,
    );
    process.exit(198);
  }

  const packagePath = fs
    .readdirSync(distributionFolder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('package.tgz'))
    .map(entry => entry.name)[0];
  if (!packagePath) {
    log.error(
      'package has not yet been published locally, have you run blueprint:synth? expected: %s/package.tgz`',
      distributionFolder,
      version,
    );
    process.exit(199);
  }

  const gqlResponse = await axios.default.post(
    'https://api-gamma.quokka.codes/graphql?',
    {
      query: `mutation {
        createBlueprintUploadUrl(input: {
          organizationName: "${publisher}",
          publisher: "${publisher}",
          name: "${friendlyBlueprintName}",
          version: "${version}" }) {
            uploadUrl, publishingJobId }
          }`,
    },
    {
      headers: {
        'authority': 'api-gamma.quokka.codes',
        'accespt': 'application/json',
        'origin': 'https://api-gamma.quokka.codes',
        'x-api-key': 'CBxZwFn2o0pofwuIE0yR',
        'cookie': cookie,
        'content-type': 'application/json',
      },
    },
  );
  if (gqlResponse.status != 200) {
    log.error('unable to retrive upload url: %s', gqlResponse.data);
    process.exit(254);
  } else if (gqlResponse.data.errors?.[0]) {
    log.error(gqlResponse.data.errors[0]);
    process.exit(254);
  }

  const publishingJob = gqlResponse.data.data.createBlueprintUploadUrl as PublishingJob;
  log.info('started publishing job: %s', publishingJob.publishingJobId);
  log.info('started publishing job URI: %s', publishingJob.uploadUrl);

  const uploadResponse = await axios.default.put(
    publishingJob.uploadUrl,
    fs.readFileSync(path.join(distributionFolder, packagePath)),
  );
  if (uploadResponse.status != 200) {
    log.error('failed to upload template package: %s', uploadResponse.status);
    process.exit(254);
  }

  log.info('uploaded package for processing');
}