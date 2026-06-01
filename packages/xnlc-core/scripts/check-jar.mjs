import AdmZip from 'adm-zip';

const jarPath = process.argv[2] || 'C:\\Users\\MAINER4IK\\AppData\\Roaming\\xneonlauncher\\minecraft-test\\libraries\\net\\minecraftforge\\forge\\1.5.2-7.8.1.738\\forge-1.5.2-7.8.1.738-universal.jar';

try {
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries();
  
  // Search for launcher or tweaker related classes
  const launcherEntries = entries.filter(e => 
    e.entryName.toLowerCase().includes('launcher') || 
    e.entryName.toLowerCase().includes('tweaker')
  );
  console.log('Launcher/Tweaker entries found:');
  launcherEntries.forEach(e => console.log(e.entryName));
  
  // Also look at net.minecraft classes in the jar
  const mcEntries = entries.filter(e => e.entryName.startsWith('net/minecraft/'));
  console.log('\nnet.minecraft/ entries (first 20):');
  mcEntries.slice(0, 20).forEach(e => console.log(e.entryName));
  
  // Check for main classes or entry points
  console.log('\nAll .class files in root:');
  entries.filter(e => e.entryName.endsWith('.class') && !e.entryName.includes('/'))
    .forEach(e => console.log(e.entryName));
} catch (err) {
  console.error('Error:', err.message);
}
