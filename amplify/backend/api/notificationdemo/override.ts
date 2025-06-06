import { AmplifyApiGraphQlResourceStackTemplate, AmplifyProjectInfo } from '@aws-amplify/cli-extensibility-helper';

export function override(resources: AmplifyApiGraphQlResourceStackTemplate, amplifyProjectInfo: AmplifyProjectInfo) {
    console.log("Api overrride ",amplifyProjectInfo.envName)

  const { Feedback } = resources.models;
  if (Feedback) {
    const table = Feedback.modelDDBTable
    table.streamSpecification = {
      streamViewType: 'NEW_AND_OLD_IMAGES' // Options: KEYS_ONLY, NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES
    };
    table.addPropertyOverride('Tags', [
      { Key: 'Demo', Value: 'True' }
    ]);
  }

}
