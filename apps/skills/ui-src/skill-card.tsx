import React from 'react';
import {CatalogCard, Icon} from '@pero/app-sdk/ui';

export function SkillCard({name, category, description, publisher, icon, version, status, action, onOpen}: {
  name: string;
  category?: string;
  description: string;
  publisher: string;
  icon: string;
  version: {label: string; full: string};
  status?: React.ReactNode;
  action?: React.ReactNode;
  onOpen: () => void;
}) {
  return <CatalogCard title={name} icon={<Icon name={icon} size={19}/>} subtitle={publisher}
    description={description} status={status} action={action} onOpen={onOpen}
    metadata={<>
      {category && <span className="skills-card-publisher" title={category}>{category}</span>}
      <span className="skills-card-version" title={version.full}>{version.label}</span>
    </>}/>;
}
