// Runs the fake Canvas from the e2e tests so it can be opened by hand (manual testing,
// store screenshots). It contains no real student data.
//   npm run fixture
import { startServer } from './server';

const PORT = Number(process.env.PORT) || 4321;
const { origin } = await startServer(PORT);
console.log(`Fake SpeedGrader running. Press Ctrl+C to stop.

  Student with many files: ${origin}/courses/1/gradebook/speed_grader?assignment_id=2&student_id=3
  Student with one file:   ${origin}/courses/1/gradebook/speed_grader?assignment_id=2&student_id=4

Load the test build (.output/e2e-chrome-mv3, from "npm run build:e2e") and add
"http://localhost" under Canvas sites in SpeedView's settings.`);
